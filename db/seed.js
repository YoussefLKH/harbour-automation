// ════════════════════════════════════════════════════════════
// Seed a test client + sample data so we can build/preview the
// client dashboard before the admin invite flow exists.
//   Run:  node db/seed.js
// ════════════════════════════════════════════════════════════
require('dotenv').config({ override: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_EMAIL = 'client@harbourtest.ca';
const TEST_PASS  = 'Harbour123!';

(async () => {
    // 1. Create (or find) the auth user
    let userId;
    const { data: created, error: cErr } = await supabase.auth.admin.createUser({
        email: TEST_EMAIL, password: TEST_PASS, email_confirm: true,
        user_metadata: { full_name: 'Sarah Chen' },
    });
    if (cErr && !/already/i.test(cErr.message)) throw cErr;
    if (created?.user) {
        userId = created.user.id;
    } else {
        // already exists — look it up
        const { data: list } = await supabase.auth.admin.listUsers();
        userId = list.users.find(u => u.email === TEST_EMAIL)?.id;
    }
    console.log('✓ Test user:', TEST_EMAIL, '→', userId);

    // 2. Profile
    await supabase.from('profiles').upsert({
        id: userId, full_name: 'Sarah Chen', business_name: 'Coastal Cuts Salon',
        email: TEST_EMAIL, phone: '(902) 555-0123', role: 'client', status: 'active',
    });

    // 3. Sample systems
    const { data: existingSys } = await supabase.from('systems').select('id').eq('client_id', userId);
    if (!existingSys?.length) {
        await supabase.from('systems').insert([
            { client_id: userId, name: 'AI Receptionist', type: 'receptionist', status: 'live', description: 'Answers calls 24/7, books appointments, texts confirmations.' },
            { client_id: userId, name: 'Appointment Reminders', type: 'followup', status: 'live', description: 'SMS confirmations + day-before reminders to cut no-shows.' },
            { client_id: userId, name: 'Online Booking Widget', type: 'followup', status: 'building', description: 'Self-serve booking embedded on the website + Instagram.' },
        ]);
    }

    // 4. Sample monthly report
    const { data: existingRep } = await supabase.from('reports').select('id').eq('client_id', userId);
    if (!existingRep?.length) {
        await supabase.from('reports').insert([
            { client_id: userId, period: '2026-05', calls_handled: 142, hours_saved: 19.5, leads_captured: 38, summary: 'Strong month — the receptionist recovered 142 calls that would have gone to voicemail, and reminders cut no-shows roughly in half.' },
        ]);
    }

    // 5. Sample invoice
    const { data: existingInv } = await supabase.from('invoices').select('id').eq('client_id', userId);
    if (!existingInv?.length) {
        await supabase.from('invoices').insert([
            { client_id: userId, description: 'Monthly retainer — June 2026', amount_cents: 49900, currency: 'cad', status: 'paid', due_date: '2026-06-01' },
            { client_id: userId, description: 'Monthly retainer — July 2026', amount_cents: 49900, currency: 'cad', status: 'sent', due_date: '2026-07-01' },
        ]);
    }

    // 6. Clean up the earlier test application row
    await supabase.from('applications').delete().eq('email', 'test@example.com');

    console.log('\n✓ Seed complete. Log in with:');
    console.log('   Email:    ' + TEST_EMAIL);
    console.log('   Password: ' + TEST_PASS);
    process.exit(0);
})().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
