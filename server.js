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

// Request logger (dev) + kill ALL caching so nothing is served stale from the browser
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const t = Date.now();
    res.on('finish', () => console.log(`${req.method} ${req.url} → ${res.statusCode} (${Date.now() - t}ms)`));
    next();
});

// Never cache HTML during dev (avoids stale pages); static assets fine to cache
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); },
}));

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e && e.message ? e.message : e));

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

// ── Stripe ──
const crypto = require('crypto');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
if (stripe) console.log('✓ Stripe connected'); else console.log('⚠ STRIPE_SECRET_KEY missing — payment links disabled.');

// ── Email ──
const mailer = require('./mailer');

// ── Health ──
app.get('/api/health', (_req, res) => res.json({
    ok: true,
    claude: Boolean(claude),
    supabase: Boolean(supabase),
}));
app.get('/api/config', (_req, res) => res.json({
    calendlyUrl: process.env.CALENDLY_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
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

QUICK-REPLY OPTIONS (use these often — they make it effortless for the owner):
- Whenever your question naturally implies a choice — anything you'd phrase as "X or Y", a yes/no, a range, or picking from a few categories — you MUST add 2-4 tappable options.
- Put them on their OWN LAST line in EXACTLY this format: [[OPTIONS: First choice | Second choice | Third choice]]
- Example — if you ask "When you miss a call, does it go to voicemail or do they just hang up?", end your message with:
  [[OPTIONS: Goes to voicemail | They hang up | A bit of both]]
- Only skip options for genuinely open-ended prompts ("walk me through a typical day").
- The [[OPTIONS:...]] tag is machine-read and hidden from the user — never mention it or repeat the choices inside your sentence.

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
            const base = {
                full_name: record.full_name, business_name: record.business_name,
                email: record.email, phone: record.phone, industry: record.industry,
                team_size: record.team_size, pain_points: record.pain_points,
                biggest_challenge: record.biggest_challenge, status: 'pending',
            };
            let { error } = await supabase.from('applications').insert({ ...base, transcript: record.transcript, plan: record.plan });
            // If the admin migration hasn't been run yet, transcript/plan columns won't exist — fall back gracefully
            if (error && /transcript|plan|column/i.test(error.message)) {
                ({ error } = await supabase.from('applications').insert(base));
            }
            if (error) throw error;
        } else {
            // Local fallback so nothing is lost during dev
            const file = path.join(__dirname, 'db', 'applications.local.json');
            const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
            existing.push({ ...record, id: Date.now(), created_at: new Date().toISOString() });
            fs.writeFileSync(file, JSON.stringify(existing, null, 2));
        }

        // Notify the team of the new application (non-blocking)
        const adminEmail = ADMIN_EMAILS[0] || process.env.EMAIL_USER;
        if (adminEmail) mailer.sendNewApplicationEmail(adminEmail, record).catch(e => console.error('New-application email failed:', e.message));

        res.json({ success: true });
    } catch (e) {
        console.error('apply/submit error:', e.message);
        res.status(500).json({ error: 'Could not save application.' });
    }
});

// ── Applicant booked a discovery call (fired from the Calendly embed) ──
app.post('/api/apply/booked', async (req, res) => {
    try {
        const a = req.body || {};
        const adminEmail = ADMIN_EMAILS[0] || process.env.EMAIL_USER;
        if (adminEmail) mailer.sendCallBookedEmail(adminEmail, a).catch(e => console.error('Call-booked email failed:', e.message));
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

// ════════════════════════════════════════════════════════════
// CLIENT AUTH + DASHBOARD
// Auth: frontend signs in with Supabase, sends the access token;
// we verify it and use the service role for DB work.
// ════════════════════════════════════════════════════════════
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function authClient(req, res, next) {
    if (!supabase) return res.status(503).json({ error: 'Database not configured.' });
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Not signed in.' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Session expired.' });
    req.user = data.user;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    req.profile = profile || { id: data.user.id, email: data.user.email };
    req.isAdmin = ADMIN_EMAILS.includes((data.user.email || '').toLowerCase()) || profile?.role === 'admin';
    next();
}

// ── Profile ──
app.get('/api/me', authClient, (req, res) => res.json({ ...req.profile, isAdmin: req.isAdmin }));

// ── Overview (stat cards) ──
app.get('/api/me/overview', authClient, async (req, res) => {
    try {
        const uid = req.user.id;
        const [{ data: systems }, { data: reports }, { data: invoices }] = await Promise.all([
            supabase.from('systems').select('status').eq('client_id', uid),
            supabase.from('reports').select('*').eq('client_id', uid).order('period', { ascending: false }).limit(1),
            supabase.from('invoices').select('amount_cents,status').eq('client_id', uid),
        ]);
        const latest = reports?.[0] || {};
        const openInv = (invoices || []).filter(i => i.status === 'sent');
        res.json({
            systemsLive: (systems || []).filter(s => s.status === 'live').length,
            systemsTotal: (systems || []).length,
            hoursSaved: latest.hours_saved || 0,
            callsHandled: latest.calls_handled || 0,
            leadsCaptured: latest.leads_captured || 0,
            period: latest.period || null,
            openInvoices: openInv.length,
            openAmount: openInv.reduce((s, i) => s + (i.amount_cents || 0), 0),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me/systems', authClient, async (req, res) => {
    const { data, error } = await supabase.from('systems').select('*').eq('client_id', req.user.id).order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ systems: data || [] });
});

app.get('/api/me/reports', authClient, async (req, res) => {
    const { data, error } = await supabase.from('reports').select('*').eq('client_id', req.user.id).order('period', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ reports: data || [] });
});

app.get('/api/me/invoices', authClient, async (req, res) => {
    const { data, error } = await supabase.from('invoices').select('*').eq('client_id', req.user.id).order('due_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ invoices: data || [] });
});

// ── Support chat ──
async function getOrCreateThread(uid, profile) {
    let { data: thread } = await supabase.from('support_threads').select('*').eq('client_id', uid).single();
    if (!thread) {
        const { data } = await supabase.from('support_threads')
            .insert({ client_id: uid, status: 'open' }).select().single();
        thread = data;
    }
    return thread;
}

app.get('/api/me/support', authClient, async (req, res) => {
    try {
        const thread = await getOrCreateThread(req.user.id, req.profile);
        const { data: messages } = await supabase.from('support_messages')
            .select('*').eq('thread_id', thread.id).order('created_at');
        res.json({ thread, messages: messages || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/me/support', authClient, async (req, res) => {
    try {
        const text = (req.body.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Message required.' });
        const thread = await getOrCreateThread(req.user.id, req.profile);
        const isFirst = !thread.last_message_at;

        await supabase.from('support_messages').insert({
            thread_id: thread.id, sender_role: 'client',
            sender_name: req.profile.full_name || req.profile.email, body: text,
        });
        await supabase.from('support_threads').update({
            last_message: text.slice(0, 120), last_message_at: new Date().toISOString(),
            unread_by_admin: true, status: 'open',
        }).eq('id', thread.id);

        // Auto-reply on the very first message so they're not talking to themselves
        if (isFirst) {
            await supabase.from('support_messages').insert({
                thread_id: thread.id, sender_role: 'admin', sender_name: 'Harbour Team',
                body: "Thanks for reaching out! 🌊 Youssef has been notified and will reply shortly. You'll get an email when there's a response.",
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Invite redemption (creates the client account) ──
app.post('/api/invite/redeem', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database not configured.' });
    try {
        const { token, password, full_name } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });

        const { data: invite } = await supabase.from('invites').select('*').eq('token', token).single();
        if (!invite || invite.status !== 'sent') return res.status(400).json({ error: 'This invite is invalid or already used.' });
        if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'This invite has expired.' });

        const { data: created, error: cErr } = await supabase.auth.admin.createUser({
            email: invite.email, password, email_confirm: true,
            user_metadata: { full_name: full_name || '' },
        });
        if (cErr) return res.status(400).json({ error: cErr.message });

        await supabase.from('profiles').upsert({
            id: created.user.id, email: invite.email, full_name: full_name || '',
            role: 'client', status: 'active',
        });
        await supabase.from('invites').update({ status: 'accepted' }).eq('id', invite.id);
        res.json({ success: true, email: invite.email });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════
function requireAdmin(req, res, next) {
    authClient(req, res, () => {
        if (!req.isAdmin) return res.status(403).json({ error: 'Admins only.' });
        next();
    });
}

// ── Applications ──
app.get('/api/admin/applications', requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ applications: data || [] });
});

app.patch('/api/admin/applications/:id', requireAdmin, async (req, res) => {
    const updates = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.admin_notes !== undefined) updates.admin_notes = req.body.admin_notes;
    if (req.body.status) updates.reviewed_at = new Date().toISOString();
    const { error } = await supabase.from('applications').update(updates).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ── Accept an application → create invite + send activation link ──
app.post('/api/admin/applications/:id/accept', requireAdmin, async (req, res) => {
    try {
        const { data: appn } = await supabase.from('applications').select('*').eq('id', req.params.id).single();
        if (!appn) return res.status(404).json({ error: 'Application not found.' });

        const token = crypto.randomBytes(24).toString('hex');
        await supabase.from('invites').insert({
            application_id: appn.id, email: appn.email, token, status: 'sent',
        });
        await supabase.from('applications').update({ status: 'accepted', reviewed_at: new Date().toISOString() }).eq('id', appn.id);

        const link = `${process.env.APP_URL || ''}/login.html?invite=${token}`;
        let emailed = false;
        try { emailed = await mailer.sendActivationEmail(appn.email, appn.full_name, link); }
        catch (e) { console.error('Activation email failed:', e.message); }

        res.json({ success: true, link, emailed });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Clients ──
app.get('/api/admin/clients', requireAdmin, async (req, res) => {
    const { data: profiles } = await supabase.from('profiles').select('*').eq('role', 'client').order('created_at', { ascending: false });
    res.json({ clients: profiles || [] });
});

app.get('/api/admin/clients/:id', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const [{ data: profile }, { data: systems }, { data: invoices }, { data: thread }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('systems').select('*').eq('client_id', id).order('created_at'),
        supabase.from('invoices').select('*').eq('client_id', id).order('created_at', { ascending: false }),
        supabase.from('support_threads').select('*').eq('client_id', id).single(),
    ]);
    let messages = [];
    if (thread) { const { data: m } = await supabase.from('support_messages').select('*').eq('thread_id', thread.id).order('created_at'); messages = m || []; }
    res.json({ profile, systems: systems || [], invoices: invoices || [], thread: thread || null, messages });
});

app.post('/api/admin/clients/:id/systems', requireAdmin, async (req, res) => {
    const { name, type, status, description } = req.body;
    if (!name) return res.status(400).json({ error: 'System name required.' });
    const { error } = await supabase.from('systems').insert({
        client_id: req.params.id, name, type: type || null, status: status || 'building', description: description || '',
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.patch('/api/admin/systems/:id', requireAdmin, async (req, res) => {
    const { error } = await supabase.from('systems').update({ status: req.body.status }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ── Create invoice + Stripe one-time payment link ──
app.post('/api/admin/clients/:id/invoices', requireAdmin, async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
        const { description, amount } = req.body;            // amount in dollars
        const cents = Math.round(parseFloat(amount) * 100);
        if (!description || !cents || cents < 50) return res.status(400).json({ error: 'Description and a valid amount are required.' });

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            customer_email: profile?.email || undefined,
            line_items: [{
                price_data: { currency: 'cad', product_data: { name: description }, unit_amount: cents },
                quantity: 1,
            }],
            success_url: `${process.env.APP_URL || ''}/dashboard.html?paid=1`,
            cancel_url: `${process.env.APP_URL || ''}/dashboard.html`,
        });

        const { error } = await supabase.from('invoices').insert({
            client_id: req.params.id, description, amount_cents: cents, currency: 'cad',
            status: 'sent', payment_url: session.url, stripe_session_id: session.id,
        });
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true, payment_url: session.url });
    } catch (e) { console.error('invoice error:', e.message); res.status(500).json({ error: e.message }); }
});

// ── Admin support ──
app.get('/api/admin/support', requireAdmin, async (req, res) => {
    const { data: threads } = await supabase.from('support_threads').select('*').order('last_message_at', { ascending: false, nullsFirst: false });
    // attach client names
    const out = [];
    for (const t of (threads || [])) {
        const { data: p } = await supabase.from('profiles').select('full_name,business_name,email').eq('id', t.client_id).single();
        out.push({ ...t, client: p });
    }
    res.json({ threads: out });
});

app.get('/api/admin/support/:threadId', requireAdmin, async (req, res) => {
    const { data: messages } = await supabase.from('support_messages').select('*').eq('thread_id', req.params.threadId).order('created_at');
    await supabase.from('support_threads').update({ unread_by_admin: false }).eq('id', req.params.threadId);
    res.json({ messages: messages || [] });
});

app.post('/api/admin/support/:threadId/reply', requireAdmin, async (req, res) => {
    try {
        const text = (req.body.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Reply required.' });
        const { data: thread } = await supabase.from('support_threads').select('*').eq('id', req.params.threadId).single();
        await supabase.from('support_messages').insert({
            thread_id: req.params.threadId, sender_role: 'admin', sender_name: 'Youssef — Harbour', body: text,
        });
        await supabase.from('support_threads').update({
            last_message: 'Youssef: ' + text.slice(0, 100), last_message_at: new Date().toISOString(),
            unread_by_admin: false, unread_by_client: true,
        }).eq('id', req.params.threadId);

        // notify client by email
        if (thread) {
            const { data: p } = await supabase.from('profiles').select('email,full_name').eq('id', thread.client_id).single();
            if (p?.email) mailer.sendSupportReplyEmail(p.email, p.full_name, text).catch(e => console.error('reply email:', e.message));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`🌊 Harbour Automation → http://localhost:${PORT}`));
