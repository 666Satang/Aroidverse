// label.js — shipping label (ใบปะหน้า) for a small thermal printer, drawn with Canvas 2D (no libraries).
// Pure black on white, bold weights, no hairlines. The canvas is binarised at the end so the printer app
// never has to dither anti-aliased grey edges.
// A future direct-print path only needs `labelBitmap(canvas)` (1-bit packed rows) — see bottom of file.

const FONT = '"Helvetica Neue", Helvetica, Arial, "Noto Sans Thai", "Sukhumvit Set", "Thonburi", "Leelawadee UI", "Loma", sans-serif';
const str = (v) => (v === null || v === undefined ? '' : String(v));
const trim = (v) => str(v).trim();

export const LABEL_DEFAULTS = {
  label_width_mm: 50, label_height_mm: 50, label_dpi: 300, label_rotate: false,
  label_show_sender: true, label_sender_phone: '', label_sender_address: '', label_show_order_no: true,
};

// ---------------------------------------------------------------- data
const isThailand = (c) => /^(th|tha|thai|thailand|ไทย|ประเทศไทย|สยาม)$/i.test(trim(c).replace(/\./g, ''));

export function labelData({ order, customer, settings, overrides } = {}) {
  order = order || {}; customer = customer || {}; settings = settings || {}; overrides = overrides || {};
  const pick = (k, fb) => (overrides[k] !== undefined && overrides[k] !== null ? trim(overrides[k]) : trim(fb));
  const name = pick('name', customer.name) || trim(order.customer_name);
  const showSender = settings.label_show_sender !== false;
  return {
    name,
    phone: pick('phone', customer.phone),
    address: pick('address', customer.address),
    country: pick('country', customer.country),
    sender: showSender ? { name: trim(settings.shop_name), phone: trim(settings.label_sender_phone), address: trim(settings.label_sender_address) } : null,
    order_no: settings.label_show_order_no === false ? '' : (trim(order.invoice_no) || trim(order.code)),
  };
}

export function labelSettings(settings) {
  const s = Object.assign({}, LABEL_DEFAULTS, settings || {});
  const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  return {
    w: clamp(s.label_width_mm, 20, 200, 50), h: clamp(s.label_height_mm, 20, 300, 50),
    dpi: clamp(s.label_dpi, 100, 600, 300), rotate: s.label_rotate === true || s.label_rotate === 'true',
  };
}
export function labelPixelSize(settings) {
  const L = labelSettings(settings);
  return { width: Math.round(L.w / 25.4 * L.dpi), height: Math.round(L.h / 25.4 * L.dpi), w_mm: L.w, h_mm: L.h, dpi: L.dpi };
}

// ---------------------------------------------------------------- text wrapping (Thai aware)
let wordSeg = null, graphSeg = null;
try { if (typeof Intl !== 'undefined' && Intl.Segmenter) { wordSeg = new Intl.Segmenter('th', { granularity: 'word' }); graphSeg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } } catch (e) { wordSeg = null; graphSeg = null; }
const words = (t) => {
  const raw = wordSeg ? Array.from(wordSeg.segment(t), (s) => s.segment) : t.split(/(\s+)/).filter((s) => s !== '');
  const out = []; // keep closing punctuation / hyphens glued to the word before them
  raw.forEach((w) => { if (out.length && /^[-\u2013,.;:!?)\]\/\u2026]+$/.test(w)) out[out.length - 1] += w; else out.push(w); });
  return out;
};
const glyphs = (t) => (graphSeg ? Array.from(graphSeg.segment(t), (s) => s.segment) : Array.from(t));

function wrap(ctx, text, maxW) {
  const out = [];
  str(text).replace(/\r/g, '').split('\n').forEach((para) => {
    if (!para.trim()) return;
    let line = '';
    const push = () => { out.push(line.replace(/\s+$/, '')); line = ''; };
    words(para.trim()).forEach((tok) => {
      if (ctx.measureText(line + tok).width <= maxW) { line += tok; return; }
      if (line.trim()) push();
      tok = tok.replace(/^\s+/, '');
      if (ctx.measureText(tok).width <= maxW) { line = tok; return; }
      glyphs(tok).forEach((ch) => { if (line && ctx.measureText(line + ch).width > maxW) push(); line += ch; });
    });
    if (line.trim()) push();
  });
  return out;
}
function ellipsize(ctx, line, maxW) {
  if (ctx.measureText(line).width <= maxW && !/…$/.test(line)) return line;
  const g = glyphs(line.replace(/…$/, ''));
  while (g.length && ctx.measureText(g.join('').replace(/\s+$/, '') + '…').width > maxW) g.pop();
  return g.join('').replace(/\s+$/, '') + '…';
}
function limitLines(ctx, lines, max) {
  if (lines.length <= max) return lines;
  const cut = lines.slice(0, max);
  cut[max - 1] = cut[max - 1] + '…';
  return cut;
}

// ---------------------------------------------------------------- layout
// Base sizes are px at 300 dpi; everything is scaled by dpi/300. min = floor for the auto-fit.
const SPEC = {
  caption: { base: 25, min: 21 },
  name: { base: 68, min: 36, max: 1.1 },
  addr: { base: 40, min: 25, max: 1.2 },
  country: { base: 44, min: 28, max: 1.1 },
  phone: { base: 44, min: 28, max: 1.1 },
  from: { base: 25, min: 23 },
  fromAddr: { base: 23, min: 21 },
  order: { base: 25, min: 23 },
};
const LH = 1.3;          // line height (em) — Thai stacked marks need room
const BASE_OFF = 1.04;   // baseline offset from line top (em)

function layoutLabel(lctx, lw, lh, data, k) {
  const pad = Math.round((lh < 420 * k ? 28 : 36) * k);
  const inner = lw - pad * 2;
  const font = (size) => '700 ' + size + 'px ' + FONT;
  const sz = (key, scale) => Math.round(Math.max(SPEC[key].min, SPEC[key].base * Math.min(scale, SPEC[key].max || 9)) * k);
  const gap = (scale) => Math.round(Math.max(7, 14 * scale) * k);
  const rule = Math.max(3, Math.round(3 * k));

  // footer is sized independently of the recipient scale (small but always legible)
  // level 0: sender + phone + address, 1: sender + phone, 2: sender name only, 3: order number only
  function footer(level) {
    const items = { h: 0, rows: [], rule };
    const sd = data.sender;
    const fs = Math.round(SPEC.from.base * k), as = Math.round(SPEC.fromAddr.base * k), os = Math.round(SPEC.order.base * k);
    const orderTxt = data.order_no;
    lctx.font = font(os); const ow = orderTxt ? lctx.measureText(orderTxt).width : 0;
    const fromTxt = sd && level <= 2 && (sd.name || sd.phone) ? 'FROM: ' + (sd.name || sd.phone) : '';
    const phoneTxt = sd && level <= 1 && sd.name && sd.phone ? 'Tel. ' + sd.phone : '';
    const addrTxt = sd && level === 0 ? sd.address : '';
    if (!fromTxt && !orderTxt) return items;
    const lhF = Math.round(fs * LH), lhA = Math.round(as * LH);
    let y = 0;
    lctx.font = font(fs);
    const narrow = inner - ow - Math.round(18 * k);
    const inline = !!orderTxt && !!fromTxt && lctx.measureText(fromTxt).width <= narrow;
    if (fromTxt) {
      let fl = wrap(lctx, fromTxt, inline ? narrow : inner);
      if (fl.length > 2) { fl = fl.slice(0, 2); fl[1] = ellipsize(lctx, fl[1] + '…', inner); }
      fl.forEach((l) => { items.rows.push({ t: l, size: fs, x: 0, y, align: 'left' }); y += lhF; });
    }
    if (inline) items.rows.push({ t: orderTxt, size: os, x: inner, y: 0, align: 'right' });
    if (phoneTxt) { items.rows.push({ t: ellipsize(lctx, phoneTxt, inner), size: fs, x: 0, y, align: 'left' }); y += lhF; }
    if (addrTxt) {
      lctx.font = font(as);
      const al = wrap(lctx, addrTxt, inner);
      al.slice(0, 2).forEach((l, i) => { items.rows.push({ t: i === 1 && al.length > 2 ? ellipsize(lctx, l + '…', inner) : l, size: as, x: 0, y: y + i * lhA, align: 'left' }); });
      y += Math.min(2, al.length) * lhA;
    }
    if (orderTxt && !inline) { items.rows.push({ t: orderTxt, size: os, x: inner, y, align: 'right' }); y += Math.round(os * LH); }
    items.above = Math.round(10 * k);
    items.h = items.above + y + rule + Math.round(12 * k);
    return items;
  }

  function build(scale, fLevel, addrCap, o) {
    o = o || {};
    const blocks = [];
    let y = 0, fits = true, cut = false;
    const add = (b) => { blocks.push(b); y += b.h; };
    // caption
    if (!o.noCaption) {
      const cs = sz('caption', scale);
      add({ kind: 'text', lines: ['TO / ผู้รับ'], size: cs, h: Math.round(cs * LH), after: Math.round(4 * k) });
      y += blocks[0].after;
    }
    // name
    let size = sz('name', scale);
    lctx.font = font(size);
    let lines = wrap(lctx, data.name, inner);
    if (lines.length === 2) { // prefer one smaller line over an orphaned second line
      const lo = Math.max(Math.round(SPEC.name.min * k), Math.round(size * 0.72));
      for (let t = size - 2; t >= lo; t -= 2) { lctx.font = font(t); const l1 = wrap(lctx, data.name, inner); if (l1.length === 1) { size = t; lines = l1; break; } }
      lctx.font = font(size);
    }
    const nameMax = o.nameMax || (scale > 0.7 ? 2 : 3);
    if (lines.length > nameMax) { cut = true; if (size > Math.round(SPEC.name.min * k)) fits = false; lines = limitLines(lctx, lines, nameMax); lines[nameMax - 1] = ellipsize(lctx, lines[nameMax - 1], inner); }
    if (!lines.length) lines = [''];
    add({ kind: 'text', lines, size, h: Math.round(size * LH) * lines.length, after: gap(scale) });
    y += blocks[blocks.length - 1].after;
    // address
    if (data.address) {
      size = sz('addr', scale); lctx.font = font(size);
      lines = wrap(lctx, data.address, inner);
      if (addrCap && lines.length > addrCap) { cut = true; lines = lines.slice(0, addrCap); lines[addrCap - 1] = ellipsize(lctx, lines[addrCap - 1] + '…', inner); }
      add({ kind: 'text', lines, size, h: Math.round(size * LH) * lines.length, after: gap(scale) });
      y += blocks[blocks.length - 1].after;
    }
    // country
    const cty = trim(data.country);
    if (cty && !isThailand(cty)) {
      size = sz('country', scale); lctx.font = font(size);
      let t = cty.toUpperCase();
      while (size > Math.round(SPEC.country.min * k) && lctx.measureText(t).width > inner) { size--; lctx.font = font(size); }
      if (lctx.measureText(t).width > inner) t = ellipsize(lctx, t, inner);
      add({ kind: 'text', lines: [t], size, h: Math.round(size * LH), after: gap(scale) });
      y += blocks[blocks.length - 1].after;
    }
    // phone
    if (data.phone) {
      size = sz('phone', scale); lctx.font = font(size);
      let t = 'Tel. ' + data.phone;
      while (size > Math.round(SPEC.phone.min * k) && lctx.measureText(t).width > inner) { size--; lctx.font = font(size); }
      if (lctx.measureText(t).width > inner) { lines = wrap(lctx, t, inner); t = lines[0]; }
      add({ kind: 'text', lines: [t], size, h: Math.round(size * LH), after: 0 });
    }
    const f = footer(fLevel);
    const total = y + f.h;
    if (total > lh - pad * 2) fits = false;
    return { blocks, f, total, fits, y, cut };
  }

  // search: largest scale that fits; then (at the floor) drop sender address, sender, finally truncate the address
  let res = null;
  for (let s = 1.5; s >= 0.2; s -= 0.04) {
    const r = build(s, 0, 0);
    if (r.fits) { res = r; break; }
  }
  if (!res) {
    const fl = 0.2;
    for (const lvl of [1, 2, 3]) { const r = build(fl, lvl, 0); if (r.fits) { res = r; break; } }
    if (!res) {
      const tries = [{}, { noCaption: true }, { noCaption: true, nameMax: 2 }, { noCaption: true, nameMax: 1 }];
      outer: for (const o of tries) {
        for (let cap = 12; cap >= 1; cap--) { const r = build(fl, 3, cap, o); res = r; if (r.fits) break outer; }
      }
    }
  }
  res.truncated = res.cut;
  res.pad = pad; res.inner = inner; res.font = font;
  return res;
}

function drawLayout(c, lw, lh, res) {
  const { pad, inner, f } = res;
  c.textBaseline = 'alphabetic'; c.fillStyle = '#000'; c.strokeStyle = '#000';
  let y = pad;
  res.blocks.forEach((b) => {
    c.font = res.font(b.size);
    c.textAlign = 'left';
    b.lines.forEach((ln, i) => { c.fillText(ln, pad, y + i * Math.round(b.size * LH) + Math.round(b.size * BASE_OFF)); });
    y += b.h + (b.after || 0);
  });
  if (f.h) {
    const bottom = lh - pad;
    const top = bottom - f.h;
    const padv = Math.round(12 * (f.rule / 3));
    c.fillRect(pad, top + f.above, inner, f.rule);
    const y0 = top + f.above + f.rule + padv;
    f.rows.forEach((r) => {
      c.font = res.font(r.size);
      c.textAlign = r.align;
      c.fillText(r.t, pad + r.x, y0 + r.y + Math.round(r.size * BASE_OFF));
    });
  }
}

function binarize(canvas) {
  const c = canvas.getContext('2d');
  const img = c.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------- public API
export async function renderLabel(data, settings) {
  const L = labelSettings(settings), px = labelPixelSize(settings);
  const W = px.width, H = px.height, k = L.dpi / 300;
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
  data = data || {};
  const lw = L.rotate ? H : W, lh = L.rotate ? W : H;
  const lay = mk(lw, lh), lc = lay.getContext('2d');
  lc.fillStyle = '#fff'; lc.fillRect(0, 0, lw, lh);
  const res = layoutLabel(lc, lw, lh, Object.assign({ name: '', phone: '', address: '', country: '', sender: null, order_no: '' }, data), k);
  lc.fillStyle = '#000';
  drawLayout(lc, lw, lh, res);
  let out = lay;
  if (L.rotate) {
    out = mk(W, H);
    const oc = out.getContext('2d');
    oc.fillStyle = '#fff'; oc.fillRect(0, 0, W, H);
    oc.translate(W, 0); oc.rotate(Math.PI / 2); oc.drawImage(lay, 0, 0);
  }
  binarize(out);
  out.dataset.truncated = res.truncated ? '1' : '';
  return out;
}

export function labelBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้างรูปไม่สำเร็จ'))), 'image/png'));
}

export function labelFileName(order) {
  order = order || {};
  const clean = (s) => str(s).replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean('LABEL ' + (order.invoice_no || order.code || 'order') + ' ' + (order.customer_name || '')) + '.png';
}

// For a future direct Bluetooth path: 1 bit per pixel, MSB first, 1 = black, rows padded to whole bytes.
export function labelBitmap(canvas) {
  const w = canvas.width, h = canvas.height, bpr = Math.ceil(w / 8);
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data, out = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 128) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  return { width: w, height: h, bytesPerRow: bpr, data: out };
}
// export async function printDirect(canvas) { … } — added in the Bluetooth step, takes labelBitmap(canvas).
