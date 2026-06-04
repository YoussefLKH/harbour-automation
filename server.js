// ════════════════════════════════════════════════════════════
// HARBOUR AUTOMATION — server
// Phase 1: static landing. Supabase-backed API routes (apply,
// invite, dashboard, support) get added once the .env keys land.
// ════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'harbour-automation',
        supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
});

// ── Supabase client (only initializes if keys are present) ──
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('✓ Supabase connected');
} else {
    console.log('⚠ Supabase keys missing — running in static-only mode. Add them to .env to enable the app.');
}

// TODO (next phase, once Supabase is live):
//   POST /api/apply            → insert into applications + notify admin
//   GET  /api/admin/applications → list for review
//   POST /api/admin/accept/:id  → create invite + email link
//   POST /api/invite/redeem     → create auth user + profile
//   support chat routes (realtime)
//   stripe invoice routes

app.listen(PORT, () => console.log(`🌊 Harbour Automation running → http://localhost:${PORT}`));
