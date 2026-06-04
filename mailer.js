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
    const first = (name || 'there').split(' ')[0];
    const inner = `<tr><td style="padding:40px;">
        <h1 style="color:#0a2a43;font-family:Georgia,serif;font-size:1.6rem;margin:0 0 14px;">Welcome aboard, ${first}! 🌊</h1>
        <p style="color:#37576b;font-size:1rem;line-height:1.7;margin:0 0 14px;">We're thrilled to have you. Your Harbour Automation client account is ready — just set your password to activate it and access your dashboard.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#ff7a59,#f4a261);color:#fff;padding:15px 38px;border-radius:100px;font-weight:700;font-size:1rem;text-decoration:none;">Activate my account →</a>
        </div>
        <p style="color:#6f8a9c;font-size:0.85rem;line-height:1.6;margin:0;">Or paste this link into your browser:<br><span style="color:#0e7490;word-break:break-all;">${link}</span></p>
        <p style="color:#6f8a9c;font-size:0.82rem;margin:22px 0 0;">This link expires in 14 days. If you weren't expecting this, you can ignore it.</p>
      </td></tr>`;
    await transporter.sendMail({
        from: FROM(), to, subject: 'Activate your Harbour Automation account 🌊',
        html: shell(inner),
        text: `Welcome aboard, ${first}! Set your password to activate your account: ${link}`,
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

module.exports = { isEmailConfigured, sendActivationEmail, sendSupportReplyEmail };
