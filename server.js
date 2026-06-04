// ════════════════════════════════════════════════════════════
// HARBOUR AUTOMATION — server
// Phase 1: landing + AI-powered application wizard.
// Supabase + Stripe routes get fleshed out once keys land.
// ════════════════════════════════════════════════════════════
// override:true so a blank shell-level var can't shadow our .env (no-op in prod, where no .env exists)
require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-haiku-4-5-20251001';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Claude client ──
const claude = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;
if (claude) console.log('✓ Claude connected'); else console.log('⚠ ANTHROPIC_API_KEY missing — AI wizard disabled.');

// ── Supabase (optional until keys land) ──
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('✓ Supabase connected');
} else {
    console.log('⚠ Supabase keys missing — applications save to a local JSON file for now.');
}

// ── Health ──
app.get('/api/health', (_req, res) => res.json({
    ok: true,
    claude: Boolean(claude),
    supabase: Boolean(supabase),
}));
app.get('/api/config', (_req, res) => res.json({
    calendlyUrl: process.env.CALENDLY_URL || '',
}));

// ════════════════════════════════════════════════════════════
// AI APPLICATION WIZARD
// ════════════════════════════════════════════════════════════

const INTERVIEW_SYSTEM = `You are the intake specialist for Harbour Automation, a done-for-you AI automation agency in Halifax, Nova Scotia. You help small local businesses (salons, clinics, law firms, contractors, restaurants, real estate, dental, trades, etc.) figure out what parts of their business can be automated — virtual receptionists/phone answering, appointment booking, bookkeeping, customer service, and lead follow-up.

You are interviewing a business owner who is applying to work with us. Your goals:
1. Understand their business and where they're losing time and money.
2. Uncover specific, automatable pain points (missed calls, manual admin, slow follow-up, repetitive questions, scheduling chaos, invoicing).
3. Make them feel heard and understood.

RULES:
- Ask ONE focused question at a time. Keep each message to 1-3 short sentences.
- Be warm, plain-spoken, and confident — no corporate jargon, no buzzwords.
- Build on their previous answers; reference specifics they mentioned.
- Do NOT pitch packages or quote prices. This is discovery, not a sale.
- Never invent facts about their business — ask instead.

WRAPPING UP (important — to respect their time and our costs):
- You only need: their industry/business, their top 1-3 time-or-money drains, and a rough sense of scale. This usually takes just 3-4 of their answers.
- As SOON as you have that, STOP asking questions. Do not drag the conversation on.
- Your final message must be EXACTLY this and nothing else:
  "PERFECT! We've got everything we need to map out how we can help. 🎣 [[READY]]"
- Never include [[READY]] in any message except that final wrap-up.`;

const SUMMARY_SYSTEM = `You are a senior automation strategist at Harbour Automation (Halifax). Based on an intake interview with a small business owner, produce a concise, tailored "here's what we'd automate first" plan.

Return ONLY valid JSON (no markdown, no code fences) in exactly this shape:
{
  "headline": "one punchy sentence naming their #1 opportunity",
  "summary": "2-3 sentences in plain language reflecting their specific situation back to them",
  "recommendations": [
    { "title": "Short system name", "desc": "1 sentence on what it does for THEM specifically", "impact": "e.g. 'Recover ~12 missed calls/week'" }
  ],
  "estimate": "rough setup timeframe like '2-3 weeks'"
}

Give 2-4 recommendations, ordered by impact. Be specific to what they told you. No pricing.`;

// helper: normalize incoming message list to Claude format
function toClaudeMessages(messages = []) {
    return messages
        .filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'))
        .slice(-24)
        .map(m => ({ role: m.role, content: String(m.content) }));
}

// ── Conversational interview turn ──
const MAX_ANSWERS = 4;             // hard cap on interview length (token control)
const WRAP_UP = "PERFECT! We've got everything we need to map out how we can help. 🎣 [[READY]]";

app.post('/api/apply/chat', async (req, res) => {
    if (!claude) return res.status(503).json({ error: 'AI is not configured.' });
    try {
        const { messages = [], business = {} } = req.body;

        // Hard stop: once they've answered enough, wrap up WITHOUT calling Claude (saves tokens)
        const answers = messages.filter(m => m.role === 'user').length;
        if (answers >= MAX_ANSWERS) return res.json({ reply: WRAP_UP });

        const context = `Business context so far: ${JSON.stringify(business)}`;
        const history = toClaudeMessages(messages);

        // If no prior assistant turn, kick off with a tailored opener
        if (history.length === 0) {
            history.push({ role: 'user', content: `${context}\n\n(Start the interview with a warm, specific first question.)` });
        }

        const response = await claude.messages.create({
            model: MODEL,
            max_tokens: 400,
            system: [{ type: 'text', text: `${INTERVIEW_SYSTEM}\n\n${context}`, cache_control: { type: 'ephemeral' } }],
            messages: history,
        });
        res.json({ reply: response.content[0].text });
    } catch (e) {
        console.error('apply/chat error:', e.message);
        res.status(500).json({ error: 'AI request failed.' });
    }
});

// ── Generate the tailored recommendation plan ──
app.post('/api/apply/summary', async (req, res) => {
    if (!claude) return res.status(503).json({ error: 'AI is not configured.' });
    try {
        const { messages = [], business = {} } = req.body;
        const transcript = toClaudeMessages(messages)
            .map(m => `${m.role === 'user' ? 'Owner' : 'Harbour'}: ${m.content}`)
            .join('\n');

        const response = await claude.messages.create({
            model: MODEL,
            max_tokens: 900,
            system: SUMMARY_SYSTEM,
            messages: [{
                role: 'user',
                content: `Business: ${JSON.stringify(business)}\n\nInterview transcript:\n${transcript}\n\nProduce the JSON plan.`,
            }],
        });

        let raw = response.content[0].text.trim();
        raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        let plan;
        try { plan = JSON.parse(raw); }
        catch { plan = { headline: "Here's where we'd start", summary: raw, recommendations: [], estimate: '2-3 weeks' }; }
        res.json({ plan });
    } catch (e) {
        console.error('apply/summary error:', e.message);
        res.status(500).json({ error: 'Could not generate plan.' });
    }
});

// ── Submit the application (Supabase if available, else local JSON) ──
app.post('/api/apply/submit', async (req, res) => {
    try {
        const a = req.body || {};
        if (!a.email || !a.full_name) return res.status(400).json({ error: 'Name and email are required.' });

        const record = {
            full_name:         a.full_name,
            business_name:     a.business_name || '',
            email:             a.email,
            phone:             a.phone || '',
            industry:          a.industry || '',
            team_size:         a.team_size || '',
            pain_points:       Array.isArray(a.pain_points) ? a.pain_points : [],
            biggest_challenge: a.biggest_challenge || '',
            transcript:        a.transcript || '',
            plan:              a.plan || null,
            status:            'pending',
        };

        if (supabase) {
            const { error } = await supabase.from('applications').insert({
                full_name: record.full_name, business_name: record.business_name,
                email: record.email, phone: record.phone, industry: record.industry,
                team_size: record.team_size, pain_points: record.pain_points,
                biggest_challenge: record.biggest_challenge, status: 'pending',
            });
            if (error) throw error;
        } else {
            // Local fallback so nothing is lost during dev
            const file = path.join(__dirname, 'db', 'applications.local.json');
            const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
            existing.push({ ...record, id: Date.now(), created_at: new Date().toISOString() });
            fs.writeFileSync(file, JSON.stringify(existing, null, 2));
        }

        res.json({ success: true });
    } catch (e) {
        console.error('apply/submit error:', e.message);
        res.status(500).json({ error: 'Could not save application.' });
    }
});

app.listen(PORT, () => console.log(`🌊 Harbour Automation → http://localhost:${PORT}`));
