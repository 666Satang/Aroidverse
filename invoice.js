// invoice.js — วาดใบแจ้งหนี้ภาษาอังกฤษเป็นรูปภาพด้วย Canvas 2D (ไม่ใช้ไลบรารี)
const W = 1240;
const M = 80;                       // ขอบซ้าย/ขวา
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans Thai", "Sukhumvit Set", "Helvetica Neue", Arial, sans-serif';
const C = {
  sage: '#5E9B7B', sageDark: '#3F7A5C', mint: '#E8F3EC', ink: '#26302B', muted: '#7C877F',
  line: '#E3E8E4', danger: '#C0453B', orange: '#C26A2E'
};
const STATUS = {
  'PAID': ['#2E7D5B', '#E8F3EC'],
  'DEPOSIT PAID': ['#6A4FA3', '#EFEAF8'],
  'PARTIALLY PAID': ['#C26A2E', '#FDEFE6'],
  'UNPAID': ['#C0453B', '#FBEAE8'],
  'CANCELLED': ['#6B746E', '#ECEFED']
};

const str = (v) => (v === null || v === undefined ? '' : String(v));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function fmtNum(n) { return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) {
  const m = str(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return str(d);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return parseInt(m[3], 10) + ' ' + mon[parseInt(m[2], 10) - 1] + ' ' + m[1];
}

let segmenter = null;
try { if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e) { segmenter = null; }

function tokens(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.split(/(\s+)/).filter((s) => s !== '');
}

// ตัดคำให้พอดีความกว้าง (รองรับไทยที่ไม่มีเว้นวรรค และคำยาวเกินบรรทัด)
function wrap(ctx, text, maxW) {
  const out = [];
  str(text).replace(/\r/g, '').split('\n').forEach((para) => {
    if (para.trim() === '') { out.push(''); return; }
    let line = '';
    const push = () => { out.push(line.replace(/\s+$/, '')); line = ''; };
    tokens(para).forEach((tok) => {
      if (ctx.measureText(line + tok).width <= maxW) { line += tok; return; }
      if (line.trim() !== '') push();
      tok = tok.replace(/^\s+/, '');
      if (ctx.measureText(tok).width <= maxW) { line = tok; return; }
      for (const ch of Array.from(tok)) {
        if (ctx.measureText(line + ch).width > maxW && line) push();
        line += ch;
      }
    });
    if (line !== '') push();
  });
  return out;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function summarize(order, settings) {
  const o = order || {};
  const cur = str(settings && settings.currency) || 'THB';
  const money = (n) => cur + ' ' + fmtNum(n);
  const paid = Number(o.paid_amount) || 0;
  const deposit = Number(o.deposit_amount) || 0;
  const total = Number(o.total) || 0;
  const other = round2(paid - deposit);
  const overpaid = paid > total + 0.004;
  const balance = round2(Math.max(0, total - paid));
  let label;
  if (o.status === 'cancelled') label = 'CANCELLED';
  else if (o.payment_status === 'paid') label = 'PAID';
  else if (o.payment_status === 'partial') label = (deposit > 0 && Math.abs(other) < 0.005) ? 'DEPOSIT PAID' : 'PARTIALLY PAID';
  else label = 'UNPAID';
  let depDate = '';
  (Array.isArray(o.payments) ? o.payments : []).forEach((p) => { if (p && p.type === 'deposit' && str(p.date) > depDate) depDate = p.date; });
  return { cur, money, paid, deposit, total, other, overpaid, balance, label, depDate };
}

function draw(ctx, o, s, customer, dry, H) {
  const S = summarize(o, s);
  const R = W - M;
  const font = (px, weight) => { ctx.font = (weight || 400) + ' ' + px + 'px ' + FONT; };
  const text = (t, x, y, color, align) => { ctx.fillStyle = color || C.ink; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); };
  ctx.textBaseline = 'alphabetic';

  if (!dry) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.sage; ctx.fillRect(0, 0, W, 14);
    if (S.label === 'CANCELLED') {
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 9);
      font(190, 800); ctx.fillStyle = 'rgba(107,116,110,0.09)'; ctx.textAlign = 'center'; ctx.fillText('CANCELLED', 0, 60);
      ctx.restore();
    }
  }

  // ---- header
  let y = 14 + 76;
  font(44, 700);
  const shopLines = wrap(ctx, s.shop_name || 'Shop', 560);
  let ly = y;
  shopLines.forEach((ln) => { if (!dry) text(ln, M, ly, C.sageDark); ly += 54; });
  font(24, 400);
  if (s.contact_email) { if (!dry) text(s.contact_email, M, ly - 8, C.muted); ly += 30; }
  const hdrLeftEnd = ly;

  font(54, 700);
  if (!dry) {
    ctx.save();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    text('INVOICE', R + (('letterSpacing' in ctx) ? 6 : 0), y, C.ink, 'right');
    ctx.restore();
  }
  const [stFg, stBg] = STATUS[S.label];
  font(22, 700);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  const stW = ctx.measureText(S.label).width + 48;
  if (!dry) {
    rr(ctx, R - stW, y + 24, stW, 44, 22); ctx.fillStyle = stBg; ctx.fill();
    text(S.label, R - stW / 2 + 1, y + 54, stFg, 'center');
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y = Math.max(hdrLeftEnd, y + 68) + 44;

  // ---- bill to + meta
  if (!dry) { ctx.fillStyle = C.line; ctx.fillRect(M, y - 22, R - M, 2); }
  y += 26;
  const top = y;
  font(20, 700);
  if (!dry) { if ('letterSpacing' in ctx) ctx.letterSpacing = '3px'; text('BILL TO', M, y, C.muted); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }
  y += 40;
  font(30, 700);
  wrap(ctx, (customer && customer.name) || o.customer_name || '', 540).forEach((ln) => { if (!dry) text(ln, M, y, C.ink); y += 38; });
  font(24, 400);
  if (customer && customer.country) wrap(ctx, customer.country, 540).forEach((ln) => { if (!dry) text(ln, M, y, C.ink); y += 33; });
  if (customer && customer.address) wrap(ctx, customer.address, 540).forEach((ln) => { if (!dry) text(ln, M, y, '#46514B'); y += 33; });
  const leftEnd = y;

  let my = top;
  const meta = [['Invoice no.', o.invoice_no], ['Date', fmtDate(o.order_date)]];
  if (o.tracking_no) meta.push(['Tracking no.', o.tracking_no]);
  const metaX = 700;
  meta.forEach(([k, v]) => {
    font(24, 400);
    if (!dry) text(k, metaX, my + 4, C.muted);
    font(26, 700);
    const lines = wrap(ctx, v, R - metaX - 170 - 10);
    lines.forEach((ln, i) => { if (!dry) text(ln, R, my + 4 + i * 33, C.ink, 'right'); });
    my += 44 + (lines.length - 1) * 33;
  });
  y = Math.max(leftEnd, my) + 40;

  // ---- items table
  const colAmt = R, colUnit = R - 22 - 250, colQty = R - 22 - 250 - 250, descW = colQty - 60 - M - 40;
  if (!dry) { rr(ctx, M, y, R - M, 58, 12); ctx.fillStyle = C.mint; ctx.fill(); }
  font(21, 700);
  if (!dry) {
    const hy = y + 37;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    text('DESCRIPTION', M + 22, hy, C.sageDark);
    text('QTY', colQty, hy, C.sageDark, 'center');
    text('UNIT PRICE', colUnit, hy, C.sageDark, 'right');
    text('AMOUNT', colAmt - 22, hy, C.sageDark, 'right');
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  y += 58;
  const items = Array.isArray(o.items) ? o.items : [];
  items.forEach((it) => {
    const padT = 24;
    let ry = y + padT + 22;
    font(26, 600);
    const nl = wrap(ctx, it.name, descW);
    nl.forEach((ln) => { if (!dry) text(ln, M + 22, ry, C.ink); ry += 34; });
    if (it.code || it.plant_id) {
      font(21, 400);
      const code = str(it.code || '');
      if (code) { if (!dry) text(code, M + 22, ry - 4, C.muted); ry += 28; }
    }
    const rowEnd = ry - 22 + padT;
    const qty = Number(it.qty) || 0, up = Number(it.unit_price) || 0;
    if (!dry) {
      const fy = y + padT + 22;
      font(26, 400);
      text(String(qty), colQty, fy, C.ink, 'center');
      text(S.money(up), colUnit, fy, C.ink, 'right');
      font(26, 600);
      text(S.money(up * qty), colAmt - 22, fy, C.ink, 'right');
      ctx.fillStyle = C.line; ctx.fillRect(M, rowEnd - 1, R - M, 1.5);
    }
    y = Math.max(rowEnd, y + 76);
  });
  y += 36;

  // ---- totals
  const tx = 500, tl = tx + 22, tr = R - 22;
  const row = (label, value, opts) => {
    opts = opts || {};
    font(opts.size || 25, opts.bold ? 700 : 400);
    const lw = ctx.measureText(label).width;
    const vl = value;
    if (!dry) {
      text(label, tl, y, opts.labelColor || (opts.bold ? C.ink : '#46514B'));
      font(opts.size || 25, opts.bold ? 700 : 500);
      text(vl, tr, y, opts.color || C.ink, 'right');
    }
    void lw;
    y += opts.step || 44;
  };
  row('Subtotal', S.money(o.subtotal));
  row('Shipping', S.money(o.shipping_fee));
  row('Discount', Number(o.discount) ? '- ' + S.money(o.discount) : S.money(0));
  y -= 6;
  if (!dry) { ctx.fillStyle = C.sage; ctx.fillRect(tx, y, R - tx, 3); }
  y += 44;
  row('TOTAL', S.money(o.total), { bold: true, size: 32, step: 56 });
  if (S.deposit > 0) row('Deposit received' + (S.depDate ? ' (' + fmtDate(S.depDate) + ')' : ''), S.money(S.deposit));
  if (S.other > 0.004) row('Other payments', S.money(S.other));
  else if (S.other < -0.004) row('Refunds', '- ' + S.money(-S.other));
  y += 4;
  const refund = S.overpaid;
  const balLabel = refund ? 'Refund due' : 'Balance due';
  const balVal = refund ? S.money(round2(S.paid - S.total)) : S.money(S.balance);
  const balCol = refund ? C.orange : (S.balance > 0 && S.label !== 'CANCELLED' ? C.danger : S.label === 'CANCELLED' ? '#6B746E' : '#2E7D5B');
  const balBg = refund ? '#FDEFE6' : (S.balance > 0 && S.label !== 'CANCELLED' ? '#FBEAE8' : S.label === 'CANCELLED' ? '#ECEFED' : '#E8F3EC');
  if (!dry) { rr(ctx, tx, y - 14, R - tx, 78, 16); ctx.fillStyle = balBg; ctx.fill(); }
  y += 38;
  font(30, 700);
  if (!dry) { text(balLabel, tl, y, balCol); text(balVal, tr, y, balCol, 'right'); }
  y += 62;

  // ---- payment details
  const pd = [['Bank', s.bank_name], ['Account no.', s.bank_account_no], ['Account name', s.bank_account_name], ['Email', s.contact_email]].filter((r) => str(r[1]).trim());
  if (pd.length) {
    y += 14;
    const boxTop = y;
    let by = y + 74;
    const rows = [];
    pd.forEach(([k, v]) => {
      font(25, 600);
      const lines = wrap(ctx, v, R - M - 44 - 230);
      rows.push([k, lines, by]);
      by += lines.length * 34 + 8;
    });
    const boxH = by - boxTop + 6;
    if (!dry) {
      rr(ctx, M, boxTop, R - M, boxH, 18); ctx.fillStyle = '#FAFBFA'; ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      rr(ctx, M, boxTop, 8, boxH, 4); ctx.fillStyle = C.sage; ctx.fill();
      font(22, 700);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      text('PAYMENT DETAILS', M + 30, boxTop + 40, C.sageDark);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      rows.forEach(([k, lines, ry]) => {
        font(24, 400); text(k, M + 30, ry + 8, C.muted);
        font(25, 600); lines.forEach((ln, i) => text(ln, M + 30 + 230, ry + 8 + i * 34, C.ink));
      });
    }
    y = boxTop + boxH;
  }

  // ---- note
  if (str(s.invoice_note).trim()) {
    y += 54;
    font(24, 400);
    wrap(ctx, s.invoice_note, R - M - 80).forEach((ln) => { if (!dry) text(ln, W / 2, y, '#5C6862', 'center'); y += 34; });
  }
  y += 70;
  return y;
}

export async function renderInvoice({ order, settings, customer } = {}) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
  const o = order || {}, s = settings || {}, cust = customer || {};
  const probe = document.createElement('canvas');
  probe.width = W; probe.height = 10;
  const H = Math.ceil(draw(probe.getContext('2d'), o, s, cust, true, 0));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = Math.max(H, 600);
  draw(canvas.getContext('2d'), o, s, cust, false, canvas.height);
  return canvas;
}

export async function invoiceBlob(args) {
  const canvas = await renderInvoice(args);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้างรูปบิลไม่สำเร็จ'))), 'image/png');
  });
}

export function invoiceFileName(order) {
  const o = order || {};
  const base = (str(o.invoice_no) + ' ' + str(o.customer_name)).trim() || 'invoice';
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return (clean || 'invoice') + '.png';
}
