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

// ── Stripe webhook — MUST be before express.json (needs the raw body for signature verification) ──
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).end();
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
        console.error('Webhook signature verification failed:', e.message);
        return res.status(400).send(`Webhook Error: ${e.message}`);
    }
    if (event.type === 'checkout.session.completed') {
        try { await fulfillPaidSession(event.data.object.id); }
        catch (e) { console.error('Webhook fulfill failed:', e.message); }
    }
    res.json({ received: true });
});

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
        // Confirm to the applicant so they're not left hanging
        if (record.email) mailer.sendApplicantConfirmationEmail(record.email, record.full_name).catch(e => console.error('Applicant confirmation failed:', e.message));

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

// Update my own profile (name, business, phone, email, notification prefs)
app.patch('/api/me', authClient, async (req, res) => {
    try {
        const updates = {};
        ['full_name', 'business_name', 'phone', 'email'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
        if (req.body.notify_prefs !== undefined) updates.notify_prefs = req.body.notify_prefs;
        if (!Object.keys(updates).length) return res.json({ success: true });
        const { error } = await supabase.from('profiles').update(updates).eq('id', req.user.id);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Does this client want a given category of email? (default yes)
const allowsEmail = (profile, cat) => { const p = profile?.notify_prefs; return !p || p[cat] !== false; };

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
            systemsLive: (systems || []).filter(s => s.status === 'active').length,
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

// ── Client opened Support → clear their unread flag ──
app.post('/api/me/support/read', authClient, async (req, res) => {
    try {
        await supabase.from('support_threads').update({ unread_by_client: false }).eq('client_id', req.user.id);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
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

// ── Guided support requests (question / followup / new system / problem) ──
app.post('/api/me/support/request', authClient, async (req, res) => {
    try {
        const { category, system, type, need, notes, message } = req.body;
        const thread = await getOrCreateThread(req.user.id, req.profile);

        let body = '';
        if (category === 'followup') body = `🔧 Follow-up request — ${system || 'a system'}\n\n${message || ''}`;
        else if (category === 'new_system') body = `✨ New system request\n\nLooking for: ${type || '—'}\nWhat they need: ${need || ''}${notes ? `\nNotes: ${notes}` : ''}`;
        else if (category === 'problem') body = `⚠️ Problem report — ${system || 'a system'}\n\n${message || ''}`;
        else body = (message || '').trim();
        if (!body.trim()) return res.status(400).json({ error: 'Message required.' });

        const isFirst = !thread.last_message_at;
        await supabase.from('support_messages').insert({
            thread_id: thread.id, sender_role: 'client',
            sender_name: req.profile.full_name || req.profile.email, body,
        });
        await supabase.from('support_threads').update({
            last_message: body.slice(0, 120), last_message_at: new Date().toISOString(),
            unread_by_admin: true, status: 'open',
        }).eq('id', thread.id);

        if (isFirst) {
            await supabase.from('support_messages').insert({
                thread_id: thread.id, sender_role: 'admin', sender_name: 'Harbour Team',
                body: "Thanks for reaching out! 🌊 We've got this and will reply shortly — you'll get an email when there's a response.",
            });
        }

        // Email the admin for actionable requests (new lead / something broken)
        const adminEmail = ADMIN_EMAILS[0] || process.env.EMAIL_USER;
        if (adminEmail && (category === 'new_system' || category === 'problem')) {
            mailer.sendSupportRequestEmail(adminEmail, req.profile, category, body).catch(e => console.error('Support-request email failed:', e.message));
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

        // Carry over business name / phone / plan from their application
        let appData = {};
        if (invite.application_id) {
            const { data: a } = await supabase.from('applications').select('business_name,phone,full_name,plan').eq('id', invite.application_id).single();
            appData = a || {};
        }
        const profileRow = {
            id: created.user.id, email: invite.email,
            full_name: full_name || appData.full_name || '',
            business_name: appData.business_name || '',
            phone: appData.phone || '',
            role: 'client', status: 'active',
        };
        let { error: pErr } = await supabase.from('profiles').upsert({ ...profileRow, plan: appData.plan || null });
        if (pErr && /plan|column/i.test(pErr.message)) await supabase.from('profiles').upsert(profileRow); // pre-migration fallback
        await supabase.from('invites').update({ status: 'accepted' }).eq('id', invite.id);

        // Welcome email
        mailer.sendWelcomeEmail(invite.email, profileRow.full_name).catch(e => console.error('Welcome email failed:', e.message));

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

    // Gentle decline email when passing on an applicant
    if (req.body.status === 'rejected') {
        const { data: a } = await supabase.from('applications').select('email,full_name').eq('id', req.params.id).single();
        if (a?.email) mailer.sendRejectionEmail(a.email, a.full_name).catch(e => console.error('Rejection email failed:', e.message));
    }
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

        // Prefer APP_URL, but fall back to the live request host so the link is never localhost in prod
        const base = process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        const link = `${base}/login.html?invite=${token}`;
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
    const [{ data: profile }, { data: systems }, { data: invoices }, { data: thread }, { data: requests }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('systems').select('*').eq('client_id', id).order('created_at'),
        supabase.from('invoices').select('*').eq('client_id', id).order('created_at', { ascending: false }),
        supabase.from('support_threads').select('*').eq('client_id', id).single(),
        supabase.from('requests').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    ]);
    let messages = [];
    if (thread) { const { data: m } = await supabase.from('support_messages').select('*').eq('thread_id', thread.id).order('created_at'); messages = m || []; }
    res.json({ profile, systems: systems || [], invoices: invoices || [], thread: thread || null, messages, requests: requests || [] });
});

// ── Admin: create a request/intake item for a client + email them ──
app.post('/api/admin/clients/:id/requests', requireAdmin, async (req, res) => {
    try {
        const { type, title, description } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'Title required.' });
        await supabase.from('requests').insert({
            client_id: req.params.id, type: type || 'custom', title: title.trim(), description: description || '', status: 'pending',
        });
        const { data: profile } = await supabase.from('profiles').select('full_name,email,notify_prefs').eq('id', req.params.id).single();
        if (profile?.email && allowsEmail(profile, 'documents')) mailer.sendDocumentRequestEmail(profile.email, profile.full_name, { title: title.trim(), description: description || '' })
            .catch(e => console.error('Request email failed:', e.message));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: mark a request complete ──
app.patch('/api/admin/requests/:id', requireAdmin, async (req, res) => {
    try {
        const updates = { updated_at: new Date().toISOString() };
        if (req.body.status) updates.status = req.body.status;
        const { error } = await supabase.from('requests').update(updates).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: list my requests ──
app.get('/api/me/requests', authClient, async (req, res) => {
    const { data, error } = await supabase.from('requests').select('*').eq('client_id', req.user.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ requests: data || [] });
});

// ── Client: respond to a request (mark submitted) + email admin ──
app.post('/api/me/requests/:id/respond', authClient, async (req, res) => {
    try {
        const { response, response_url } = req.body;
        if (!response?.trim() && !response_url?.trim()) return res.status(400).json({ error: 'Add a response or a link.' });
        const { data: reqRow } = await supabase.from('requests').select('*').eq('id', req.params.id).single();
        if (!reqRow || reqRow.client_id !== req.user.id) return res.status(403).json({ error: 'Not your request.' });

        await supabase.from('requests').update({
            response: response || '', response_url: response_url || '', status: 'submitted', updated_at: new Date().toISOString(),
        }).eq('id', req.params.id);

        const adminEmail = ADMIN_EMAILS[0] || process.env.EMAIL_USER;
        if (adminEmail) mailer.sendRequestFulfilledEmail(adminEmail, req.profile, reqRow, response || '', response_url || '')
            .catch(e => console.error('Request-fulfilled email failed:', e.message));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Helper: create a one-time Stripe Checkout link (CAD). meta = { system_id, kind }
async function createCheckout(productName, cents, email, meta = {}) {
    if (!stripe || !cents || cents < 50) return null;
    const kind = meta.kind || '';
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email || undefined,
        line_items: [{ price_data: { currency: 'cad', product_data: { name: productName }, unit_amount: cents }, quantity: 1 }],
        success_url: `${process.env.APP_URL || ''}/dashboard.html?paid=${kind}&sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || ''}/dashboard.html`,
        metadata: { system_id: meta.system_id || '', invoice_id: meta.invoice_id || '', kind },
    });
    return session.url;
}

// Build deposit ($50) + balance (quote − deposit) payment links for a system
async function buildSystemLinks(name, quote_cents, deposit_cents, email, system_id) {
    const dep = Math.min(deposit_cents || 5000, quote_cents);
    const bal = Math.max(quote_cents - (deposit_cents || 5000), 0);
    const deposit_url = await createCheckout(`Deposit — ${name}`, dep, email, { system_id, kind: 'deposit' });
    const balance_url = bal > 0 ? await createCheckout(`Balance — ${name}`, bal, email, { system_id, kind: 'balance' }) : null;
    return { deposit_url, balance_url };
}

// ── Add a system to a client (insert first, then attach deposit/balance links) ──
app.post('/api/admin/clients/:id/systems', requireAdmin, async (req, res) => {
    try {
        const { name, type, description, eta, quote } = req.body;
        if (!name) return res.status(400).json({ error: 'System name required.' });
        const quote_cents = quote ? Math.round(parseFloat(quote) * 100) : null;
        const deposit_cents = 5000;

        const { data: sys, error: insErr } = await supabase.from('systems').insert({
            client_id: req.params.id, name, type: type || null, description: description || '',
            eta: eta || null, status: 'waiting_deposit', quote_cents, deposit_cents,
        }).select().single();
        if (insErr) return res.status(500).json({ error: insErr.message });

        if (quote_cents) {
            const { data: profile } = await supabase.from('profiles').select('email').eq('id', req.params.id).single();
            const links = await buildSystemLinks(name, quote_cents, deposit_cents, profile?.email, sys.id);
            await supabase.from('systems').update(links).eq('id', sys.id);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Update a system: status / ETA / quote (regenerates links if quote changes) ──
app.patch('/api/admin/systems/:id', requireAdmin, async (req, res) => {
    try {
        const updates = {};
        if (req.body.status !== undefined) updates.status = req.body.status;
        if (req.body.eta !== undefined) updates.eta = req.body.eta;

        if (req.body.quote !== undefined && req.body.quote !== '') {
            const quote_cents = Math.round(parseFloat(req.body.quote) * 100);
            updates.quote_cents = quote_cents;
            const { data: sys } = await supabase.from('systems').select('name,client_id,deposit_cents').eq('id', req.params.id).single();
            if (sys) {
                const { data: profile } = await supabase.from('profiles').select('email').eq('id', sys.client_id).single();
                const links = await buildSystemLinks(sys.name, quote_cents, sys.deposit_cents, profile?.email, req.params.id);
                updates.deposit_url = links.deposit_url;
                updates.balance_url = links.balance_url;
            }
        }

        const { error } = await supabase.from('systems').update(updates).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: request final payment (In Progress → Payment Due) + email the client ──
app.post('/api/admin/systems/:id/request-payment', requireAdmin, async (req, res) => {
    try {
        const { data: sys } = await supabase.from('systems').select('*').eq('id', req.params.id).single();
        if (!sys) return res.status(404).json({ error: 'System not found.' });
        await supabase.from('systems').update({ status: 'payment_due' }).eq('id', req.params.id);
        const { data: profile } = await supabase.from('profiles').select('full_name,email,notify_prefs').eq('id', sys.client_id).single();
        if (profile?.email && allowsEmail(profile, 'payments')) {
            const bal = Math.max((sys.quote_cents || 0) - (sys.deposit_cents || 5000), 0);
            mailer.sendFinalPaymentRequestEmail(profile.email, profile.full_name, sys, bal).catch(e => console.error('Final-payment email failed:', e.message));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: ship/deliver (→ Active) + email the client ──
app.post('/api/admin/systems/:id/ship', requireAdmin, async (req, res) => {
    try {
        const { data: sys } = await supabase.from('systems').select('*').eq('id', req.params.id).single();
        if (!sys) return res.status(404).json({ error: 'System not found.' });
        await supabase.from('systems').update({ status: 'active' }).eq('id', req.params.id);
        const { data: profile } = await supabase.from('profiles').select('full_name,email,notify_prefs').eq('id', sys.client_id).single();
        if (profile?.email && allowsEmail(profile, 'payments')) mailer.sendShippedEmail(profile.email, profile.full_name, sys).catch(e => console.error('Shipped email failed:', e.message));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shared fulfillment: verify a paid Stripe session, mark paid, advance, email admin ──
// Used by BOTH the success-redirect (/api/payment/confirm) and the Stripe webhook.
// Idempotent (guards on already-paid flags), so it's safe if both fire.
async function fulfillPaidSession(sid) {
    if (!stripe || !sid) return { ok: false };
    const session = await stripe.checkout.sessions.retrieve(sid, { expand: ['payment_intent.latest_charge'] });
    if (session.payment_status !== 'paid') return { ok: false };
    const receiptUrl = session.payment_intent?.latest_charge?.receipt_url || null;
    const kind = session.metadata?.kind;
    const adminEmail = ADMIN_EMAILS[0] || process.env.EMAIL_USER;

    if (kind === 'invoice') {
        const invoiceId = session.metadata?.invoice_id;
        if (!invoiceId) return { ok: false };
        const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
        if (inv && inv.status !== 'paid') {
            await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId);
            if (receiptUrl) await supabase.from('invoices').update({ receipt_url: receiptUrl }).eq('id', invoiceId);
        }
        return { ok: true, kind };
    }

    const systemId = session.metadata?.system_id;
    if (!systemId) return { ok: false };
    const { data: sys } = await supabase.from('systems').select('*').eq('id', systemId).single();
    if (!sys) return { ok: false };
    const { data: profile } = await supabase.from('profiles').select('full_name,business_name,email').eq('id', sys.client_id).single();

    if (kind === 'deposit' && !sys.deposit_paid) {
        await supabase.from('systems').update({ deposit_paid: true, status: 'in_progress' }).eq('id', systemId);
        if (receiptUrl) await supabase.from('systems').update({ deposit_receipt_url: receiptUrl }).eq('id', systemId);
        if (adminEmail) mailer.sendDepositPaidEmail(adminEmail, profile, sys).catch(e => console.error('Deposit-paid email failed:', e.message));
    } else if (kind === 'balance' && !sys.balance_paid) {
        await supabase.from('systems').update({ balance_paid: true }).eq('id', systemId);
        if (receiptUrl) await supabase.from('systems').update({ balance_receipt_url: receiptUrl }).eq('id', systemId);
        if (adminEmail) mailer.sendBalancePaidEmail(adminEmail, profile, sys).catch(e => console.error('Balance-paid email failed:', e.message));
    }
    return { ok: true, kind };
}

// ── Client: confirm a Stripe payment (called from the success redirect) ──
app.post('/api/payment/confirm', authClient, async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
        const result = await fulfillPaidSession(req.body.sid);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create one-off charge (insert first, then attach a tagged payment link) ──
app.post('/api/admin/clients/:id/invoices', requireAdmin, async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
        const { description, amount } = req.body;            // amount in dollars
        const cents = Math.round(parseFloat(amount) * 100);
        if (!description || !cents || cents < 50) return res.status(400).json({ error: 'Description and a valid amount are required.' });

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
        const { data: inv, error: insErr } = await supabase.from('invoices').insert({
            client_id: req.params.id, description, amount_cents: cents, currency: 'cad', status: 'sent',
        }).select().single();
        if (insErr) return res.status(500).json({ error: insErr.message });

        const url = await createCheckout(description, cents, profile?.email, { invoice_id: inv.id, kind: 'invoice' });
        await supabase.from('invoices').update({ payment_url: url }).eq('id', inv.id);
        res.json({ success: true, payment_url: url });
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
            const { data: p } = await supabase.from('profiles').select('email,full_name,notify_prefs').eq('id', thread.client_id).single();
            if (p?.email && allowsEmail(p, 'support')) mailer.sendSupportReplyEmail(p.email, p.full_name, text).catch(e => console.error('reply email:', e.message));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Listen only when run directly (local dev). On Vercel the app is imported as a handler.
if (require.main === module) {
    app.listen(PORT, () => console.log(`🌊 Harbour Automation → http://localhost:${PORT}`));
}
module.exports = app;
