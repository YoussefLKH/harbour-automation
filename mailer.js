// ════════════════════════════════════════════════════════════
// HARBOUR AUTOMATION — email (Gmail App Password via nodemailer)
// ════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    console.log('✓ Email connected (' + process.env.EMAIL_USER + ')');
} else {
    console.log('⚠ EMAIL_USER/EMAIL_PASS missing — emails will be skipped (links shown in admin instead).');
}

const isEmailConfigured = () => Boolean(transporter);
const FROM = () => `"${process.env.EMAIL_FROM_NAME || 'Harbour Automation'}" <${process.env.EMAIL_USER}>`;
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const APP = () => process.env.APP_URL || 'http://localhost:3000';
const money = c => '$' + ((c || 0) / 100).toFixed(2);
const cta = (href, label, dark) => `<div style="text-align:center;margin:26px 0 0;"><a href="${href}" style="display:inline-block;background:${dark ? '#0a2a43' : 'linear-gradient(135deg,#ff7a59,#f4a261)'};color:#fff;padding:14px 34px;border-radius:100px;font-weight:700;text-decoration:none;font-size:0.95rem;">${label}</a></div>`;

// Shared ocean-themed wrapper
function shell(inner) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f6f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f6f6;padding:40px 16px;"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 12px 40px rgba(10,42,67,0.1);">
        <tr><td style="background:linear-gradient(135deg,#0a2a43,#0e7490 55%,#14b8a6);padding:36px 40px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#fff;font-family:Georgia,serif;">Harbour<span style="color:#5eead4;">.</span> Automation</div>
        </td></tr>
        ${inner}
        <tr><td style="background:#0a2a43;padding:22px 40px;text-align:center;">
          <p style="color:rgba(255,255,255,0.55);font-size:0.78rem;margin:0;">Harbour Automation · Halifax, Nova Scotia 🌊</p>
        </td></tr>
      </table>
    </td></tr></table></body></html>`;
}

async function sendActivationEmail(to, name, link) {
    if (!transporter) return false;
    const first = esc((name || 'there').split(' ')[0]);
    const inner = `<tr><td style="padding:44px 40px;">
        <p style="color:#0e7490;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 12px;">Application approved</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.7rem;line-height:1.25;margin:0 0 16px;">Welcome aboard, ${first}.</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 22px;">We're excited to start building with you. Your client account is ready — set a password below to activate it and open your dashboard, where you'll track your systems, reports, billing, and chat with our team.</p>

        <div style="text-align:center;margin:8px 0 26px;">
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#ff7a59,#f4a261);color:#fff;padding:16px 40px;border-radius:100px;font-weight:700;font-size:1rem;text-decoration:none;">Activate my account &rarr;</a>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f6f6;border-radius:14px;margin:0 0 22px;"><tr><td style="padding:18px 22px;">
          <p style="color:#0a2a43;font-size:0.82rem;font-weight:700;margin:0 0 10px;">What happens next</p>
          <p style="color:#37576b;font-size:0.9rem;line-height:1.7;margin:0;">1. Set your password &amp; log in<br>2. We get to work building your systems<br>3. Track everything live from your dashboard</p>
        </td></tr></table>

        <p style="color:#6f8a9c;font-size:0.82rem;line-height:1.6;margin:0;">Button not working? Paste this link into your browser:<br><span style="color:#0e7490;word-break:break-all;">${esc(link)}</span></p>
        <p style="color:#9fb2bd;font-size:0.78rem;margin:20px 0 0;">This secure link expires in 14 days. If you weren't expecting it, you can safely ignore this email.</p>
      </td></tr>`;
    await transporter.sendMail({
        from: FROM(), to, subject: `${first}, your Harbour Automation account is ready`,
        html: shell(inner),
        text: `Welcome aboard, ${first}! Your application was approved. Set your password to activate your account: ${link} (expires in 14 days).`,
    });
    return true;
}

// ── Admin: new application received ──
async function sendNewApplicationEmail(to, app) {
    if (!transporter) return false;
    const plan = app.plan || {};
    const recs = (plan.recommendations || []).map((r, i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eef3f3;">
           <span style="color:#0a2a43;font-weight:700;font-size:0.92rem;">${i + 1}. ${esc(r.title)}</span>
           <span style="color:#37576b;font-size:0.9rem;"> — ${esc(r.desc)}</span>
           ${r.impact ? `<br><span style="color:#0e7490;font-size:0.82rem;font-weight:600;">${esc(r.impact)}</span>` : ''}
         </td></tr>`).join('');

    const row = (k, v) => `<tr><td style="padding:7px 0;color:#6f8a9c;font-size:0.85rem;width:120px;">${k}</td><td style="padding:7px 0;color:#0a2a43;font-size:0.92rem;font-weight:600;">${esc(v) || '—'}</td></tr>`;

    const inner = `<tr><td style="padding:40px;">
        <p style="color:#0e7490;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">New application</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.55rem;margin:0 0 20px;">${esc(app.full_name)} just applied</h1>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          ${row('Business', app.business_name)}
          ${row('Email', app.email)}
          ${row('Phone', app.phone)}
          ${row('Industry', app.industry)}
          ${row('Team size', app.team_size)}
        </table>

        ${plan.headline ? `
        <p style="color:#0a2a43;font-size:0.82rem;font-weight:700;margin:0 0 6px;">AI-recommended plan</p>
        <p style="color:#0a2a43;font-family:Georgia,serif;font-size:1.05rem;margin:0 0 6px;">${esc(plan.headline)}</p>
        <p style="color:#37576b;font-size:0.9rem;line-height:1.6;margin:0 0 12px;">${esc(plan.summary)}</p>
        <table width="100%" cellpadding="0" cellspacing="0">${recs}</table>` : ''}

        <div style="text-align:center;margin:28px 0 0;">
          <a href="${APP()}/admin.html" style="display:inline-block;background:#0a2a43;color:#fff;padding:14px 34px;border-radius:100px;font-weight:700;text-decoration:none;font-size:0.95rem;">Review in dashboard &rarr;</a>
        </div>
      </td></tr>`;
    await transporter.sendMail({
        from: FROM(), to,
        subject: `New application — ${app.full_name}${app.business_name ? ' (' + app.business_name + ')' : ''}`,
        html: shell(inner),
        text: `New application from ${app.full_name} (${app.business_name}). Email: ${app.email}, Phone: ${app.phone}. Review: ${APP()}/admin.html`,
    });
    return true;
}

// ── Admin: applicant booked a discovery call ──
async function sendCallBookedEmail(to, app) {
    if (!transporter) return false;
    const inner = `<tr><td style="padding:40px;">
        <p style="color:#14b8a6;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">Discovery call booked</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.55rem;margin:0 0 14px;">${esc(app.full_name)} booked a call ✅</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 18px;">They completed the application and just scheduled a discovery call. The exact date &amp; time are in the Calendly confirmation Calendly just sent you.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f6f6;border-radius:14px;"><tr><td style="padding:16px 22px;">
          <p style="margin:0;color:#0a2a43;font-size:0.92rem;"><b>${esc(app.full_name)}</b>${app.business_name ? ' · ' + esc(app.business_name) : ''}<br>
          <span style="color:#37576b;font-size:0.88rem;">${esc(app.email)} · ${esc(app.phone)}</span></p>
        </td></tr></table>
        <div style="text-align:center;margin:26px 0 0;">
          <a href="${APP()}/admin.html" style="display:inline-block;background:#0a2a43;color:#fff;padding:13px 32px;border-radius:100px;font-weight:700;text-decoration:none;">Open dashboard &rarr;</a>
        </div>
      </td></tr>`;
    await transporter.sendMail({
        from: FROM(), to,
        subject: `📅 ${app.full_name} booked a discovery call`,
        html: shell(inner),
        text: `${app.full_name} (${app.business_name}) booked a discovery call. Exact time is in your Calendly confirmation. Contact: ${app.email}, ${app.phone}.`,
    });
    return true;
}

async function sendSupportReplyEmail(to, name, message) {
    if (!transporter) return false;
    const first = (name || 'there').split(' ')[0];
    const inner = `<tr><td style="padding:40px;">
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.5rem;margin:0 0 12px;">You got a reply 💬</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 16px;">Hey ${first}, the Harbour team replied to your message:</p>
        <div style="background:#f1f6f6;border-left:3px solid #14b8a6;border-radius:0 12px 12px 0;padding:16px 20px;color:#37576b;font-size:0.95rem;line-height:1.6;">${(message||'').replace(/</g,'&lt;')}</div>
        <div style="text-align:center;margin:28px 0 0;">
          <a href="${process.env.APP_URL || ''}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#0e7490,#14b8a6);color:#fff;padding:13px 32px;border-radius:100px;font-weight:700;text-decoration:none;">View in dashboard →</a>
        </div>
      </td></tr>`;
    await transporter.sendMail({
        from: FROM(), to, subject: 'The Harbour team replied to your message',
        html: shell(inner), text: `${first}, the Harbour team replied: ${message}`,
    });
    return true;
}

// ── Admin: deposit paid → start building ──
async function sendDepositPaidEmail(to, profile, sys) {
    if (!transporter) return false;
    const who = esc(profile?.full_name || profile?.email || 'A client');
    const inner = `<tr><td style="padding:40px;">
        <p style="color:#0f766e;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">Deposit paid 💰</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.5rem;margin:0 0 14px;">Time to start building</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 16px;"><b>${who}</b> just paid the ${money(sys.deposit_cents || 5000)} deposit for <b>${esc(sys.name)}</b> (quoted ${money(sys.quote_cents)}). The system is now <b>In Progress</b> — you're clear to begin.</p>
        ${cta(APP() + '/admin.html', 'Open dashboard →', true)}
      </td></tr>`;
    await transporter.sendMail({ from: FROM(), to, subject: `💰 Deposit paid — start building ${sys.name}`, html: shell(inner), text: `${who} paid the deposit for ${sys.name}. It's now In Progress.` });
    return true;
}

// ── Admin: balance paid → ready to ship ──
async function sendBalancePaidEmail(to, profile, sys) {
    if (!transporter) return false;
    const who = esc(profile?.full_name || profile?.email || 'A client');
    const bal = Math.max((sys.quote_cents || 0) - (sys.deposit_cents || 5000), 0);
    const inner = `<tr><td style="padding:40px;">
        <p style="color:#0f766e;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">Balance paid 💰</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.5rem;margin:0 0 14px;">Ready to ship</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 16px;"><b>${who}</b> paid the ${money(bal)} balance for <b>${esc(sys.name)}</b>. You're fully paid — hit <b>Ship</b> when it's delivered.</p>
        ${cta(APP() + '/admin.html', 'Open dashboard →', true)}
      </td></tr>`;
    await transporter.sendMail({ from: FROM(), to, subject: `💰 Balance paid — ready to ship ${sys.name}`, html: shell(inner), text: `${who} paid the balance for ${sys.name}. Ready to ship.` });
    return true;
}

// ── Client: final payment requested ──
async function sendFinalPaymentRequestEmail(to, clientName, sys, balanceCents) {
    if (!transporter) return false;
    const first = esc((clientName || 'there').split(' ')[0]);
    const inner = `<tr><td style="padding:40px;">
        <p style="color:#0e7490;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">Your system is ready</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.6rem;margin:0 0 14px;">${esc(sys.name)} is built, ${first} 🎉</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 6px;">It's finished and ready to go live. To receive it, just settle the remaining balance:</p>
        <p style="color:#0a2a43;font-family:Georgia,serif;font-size:1.8rem;margin:8px 0 0;">${money(balanceCents)}</p>
        ${sys.balance_url ? cta(sys.balance_url, 'Pay balance & receive it →') : cta(APP() + '/dashboard.html', 'Open dashboard →')}
        <p style="color:#6f8a9c;font-size:0.82rem;margin:22px 0 0;">You can also pay anytime from your dashboard.</p>
      </td></tr>`;
    await transporter.sendMail({ from: FROM(), to, subject: `Your ${sys.name} is ready — final payment`, html: shell(inner), text: `${first}, ${sys.name} is built. Pay the balance of ${money(balanceCents)} to receive it: ${sys.balance_url || APP() + '/dashboard.html'}` });
    return true;
}

// ── Client: shipped / live ──
async function sendShippedEmail(to, clientName, sys) {
    if (!transporter) return false;
    const first = esc((clientName || 'there').split(' ')[0]);
    const inner = `<tr><td style="padding:40px;">
        <p style="color:#0f766e;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;">It's live 🎉</p>
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.6rem;margin:0 0 14px;">${esc(sys.name)} is now active, ${first}!</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 16px;">Your system is delivered and running. Track its performance anytime from your dashboard — and reach out in Support if you need anything.</p>
        ${cta(APP() + '/dashboard.html', 'View my dashboard →', true)}
      </td></tr>`;
    await transporter.sendMail({ from: FROM(), to, subject: `🎉 ${sys.name} is now live`, html: shell(inner), text: `${first}, ${sys.name} is now active and running. View it: ${APP()}/dashboard.html` });
    return true;
}

module.exports = { isEmailConfigured, sendActivationEmail, sendSupportReplyEmail, sendNewApplicationEmail, sendCallBookedEmail, sendDepositPaidEmail, sendBalancePaidEmail, sendFinalPaymentRequestEmail, sendShippedEmail };
