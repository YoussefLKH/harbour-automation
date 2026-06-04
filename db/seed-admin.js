// ════════════════════════════════════════════════════════════
// Create the admin account (you). Run: node db/seed-admin.js
// ════════════════════════════════════════════════════════════
require('dotenv').config({ override: true });
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || 'yousseflkh25901@gmail.com').split(',')[0].trim();
const PASSWORD = 'Harbour-' + crypto.randomBytes(4).toString('hex'); // random temp password

(async () => {
    let userId;
    const { data: created, error } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL, password: PASSWORD, email_confirm: true,
        user_metadata: { full_name: 'Youssef Lakhal' },
    });
    if (error && !/already/i.test(error.message)) throw error;

    if (created?.user) {
        userId = created.user.id;
        console.log('✓ Admin account created.');
        console.log('   Email:    ' + ADMIN_EMAIL);
        console.log('   Password: ' + PASSWORD + '   (change it after first login)');
    } else {
        const { data: list } = await supabase.auth.admin.listUsers();
        userId = list.users.find(u => u.email === ADMIN_EMAIL)?.id;
        console.log('✓ Admin already exists (' + ADMIN_EMAIL + '). Password unchanged.');
        console.log('   If you forgot it, run: node db/reset-admin-password.js');
    }

    await supabase.from('profiles').upsert({
        id: userId, email: ADMIN_EMAIL, full_name: 'Youssef Lakhal', role: 'admin', status: 'active',
    });
    console.log('✓ Admin profile set (role=admin).');
    process.exit(0);
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
