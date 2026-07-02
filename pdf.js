// ════════════════════════════════════════════════════════════
// HARBOUR AUTOMATION — Agreement PDF generator (pdf-lib)
// ════════════════════════════════════════════════════════════
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const NAVY  = rgb(0.039, 0.165, 0.263);  // #0a2a43
const OCEAN = rgb(0.055, 0.455, 0.565);  // #0e7490
const CORAL = rgb(1, 0.478, 0.349);      // #ff7a59
const SLATE = rgb(0.216, 0.341, 0.420);  // #37576b
const GREY  = rgb(0.6, 0.65, 0.68);
const WHITE = rgb(1, 1, 1);
const money = c => '$' + ((c || 0) / 100).toFixed(2);

async function generateAgreementPdf(a) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const serif = await doc.embedFont(StandardFonts.TimesRomanBold);

    const W = 612, H = 792, M = 56;
    const page = doc.addPage([W, H]);
    let y = 0;

    // ── Header band + logo ──
    page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: NAVY });
    const cx = M + 12, cy = H - 48;
    page.drawCircle({ x: cx, y: cy - 2, size: 12, color: CORAL });                                   // sun
    page.drawCircle({ x: cx, y: cy + 11, size: 3.4, borderColor: WHITE, borderWidth: 1.8 });          // ring
    page.drawLine({ start: { x: cx, y: cy + 8 }, end: { x: cx, y: cy - 14 }, thickness: 1.8, color: WHITE });   // shank
    page.drawLine({ start: { x: cx - 9, y: cy + 3 }, end: { x: cx + 9, y: cy + 3 }, thickness: 1.8, color: WHITE }); // crossbar
    page.drawLine({ start: { x: cx - 8, y: cy - 9 }, end: { x: cx, y: cy - 14 }, thickness: 1.8, color: WHITE });   // fluke L
    page.drawLine({ start: { x: cx + 8, y: cy - 9 }, end: { x: cx, y: cy - 14 }, thickness: 1.8, color: WHITE });   // fluke R
    page.drawText('Harbour Automation', { x: M + 34, y: H - 56, size: 20, font: serif, color: WHITE });

    y = H - 132;
    const wrap = (txt, size, f) => {
        const maxW = W - 2 * M, words = String(txt).split(' '), out = []; let cur = '';
        for (const w of words) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > maxW) { out.push(cur); cur = w; } else cur = t; }
        if (cur) out.push(cur); return out;
    };
    const line = (txt, o = {}) => {
        const size = o.size || 10.5, f = o.bold ? bold : font, color = o.color || SLATE;
        for (const ln of wrap(txt, size, f)) { page.drawText(ln, { x: M, y, size, font: f, color }); y -= size * 1.55; }
    };
    const gap = (n = 10) => { y -= n; };
    const heading = t => { gap(9); line(t, { size: 11.5, bold: true, color: NAVY }); gap(1); };

    page.drawText('System Build Agreement', { x: M, y, size: 20, font: serif, color: NAVY }); y -= 24;
    line(`Date: ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`, { color: OCEAN });
    gap(4);
    line('This agreement is between Harbour Automation ("we", "us") and the Client identified by the signature below ("you", the "Client").');

    heading('1. What we\'re building');
    line(`${a.system_name}${a.system_description ? ' — ' + a.system_description : ''}`);

    heading('2. Payment');
    const dep = Math.min(a.deposit_cents || 5000, a.quote_cents || 0);
    const bal = Math.max((a.quote_cents || 0) - (a.deposit_cents || 5000), 0);
    line(`- Total project fee: ${money(a.quote_cents)}`);
    line(`- A ${money(dep)} deposit is required to begin work.`);
    line(`- The remaining ${money(bal)} is due on completion. Your finished system is released once the balance is paid in full.`);

    if (a.eta) { heading('3. Estimated timeline'); line(`We estimate delivery in approximately ${a.eta}. This is a good-faith estimate, not a binding deadline.`); }

    heading(`${a.eta ? '4' : '3'}. Ownership`);
    line('Once the balance is paid in full, the finished system and its assets are yours to keep.');

    heading(`${a.eta ? '5' : '4'}. Support & guarantee`);
    line('We include a 3-month guarantee from the day your system goes live: we will help you set it up and troubleshoot any issues with the delivered system at no extra cost. This does not cover new features or enhancements beyond the scope above, which can be added anytime and may be quoted separately.');

    heading(`${a.eta ? '6' : '5'}. Confidentiality`);
    line('We keep your business information and any data you share with us private, and use it only to build and support your system.');

    heading(`${a.eta ? '7' : '6'}. Deposit`);
    line('The deposit is non-refundable once work has begun, as it reserves our time to start your build.');

    // ── Signature block ──
    gap(16);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.82, 0.86, 0.88) });
    gap(14);
    line('Agreement', { size: 11.5, bold: true, color: NAVY }); gap(1);
    line('By signing, both parties agree to the scope, payment, and terms above.');
    gap(10);

    if (a.status === 'signed' && a.signature) {
        try {
            const b64 = a.signature.split(',').pop();
            const png = await doc.embedPng(Buffer.from(b64, 'base64'));
            const sw = 170, sh = Math.min(png.height * (sw / png.width), 55);
            page.drawImage(png, { x: M, y: y - sh, width: sw, height: sh });
            y -= sh + 4;
        } catch { gap(30); }
        page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.8, color: NAVY }); y -= 14;
        line(`Signed by: ${a.signer_name || ''}${a.signer_company ? '   ·   ' + a.signer_company : ''}`, { bold: true, color: NAVY });
        line(`Date signed: ${a.signed_at ? new Date(a.signed_at).toLocaleString('en-CA') : ''}`);
    } else {
        gap(34);
        page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.8, color: GREY }); y -= 14;
        line('Signature   ·   Name   ·   Company   ·   Date', { color: GREY });
    }

    page.drawText('Harbour Automation', { x: M, y: 38, size: 9, font: bold, color: NAVY });

    return Buffer.from(await doc.save());
}

module.exports = { generateAgreementPdf };
