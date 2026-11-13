// Shared UI helpers: context, formatting, icons, toast, sheets, dialogs, file helpers.

export const ctx = {
  store: null, adapter: null, demo: false,
  ui: { of: 'all', oq: '', limO: 60, pq: '', sold: false, limP: 60, cq: '', cch: 'all', limC: 60, menu: null },
  nav: { tab: () => {}, menu: () => {}, orders: () => {}, rerender: () => {} },
};
export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
export const str = (v) => (v == null ? '' : String(v));
export const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const store = () => ctx.store;
export const today = () => ctx.store.state.today;

export function money(n) {
  n = Math.round((Number(n) || 0) * 100) / 100;
  const neg = n < 0; n = Math.abs(n);
  const s = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? '-' : '') + '฿' + s;
}
export const fmtN = (n) => { n = Math.round(Number(n) || 0); return n === 0 ? '–' : n.toLocaleString('en-US'); };
export const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export function fmtDate(s, short) {
  s = str(s); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return s;
  const y = +m[1], cur = String(ctx.store ? ctx.store.state.today : '').slice(0, 4);
  return +m[3] + ' ' + MON[+m[2] - 1] + (short && String(y) === cur ? '' : ' ' + y);
}
export const CH = { facebook: 'Facebook', instagram: 'Instagram', walkin: 'หน้าร้าน', other: 'อื่นๆ' };
export const WALKIN_NAME = 'ลูกค้าหน้าร้าน';
export const errMsg = (e) => ((e && e.message) ? e.message : String(e)).replace(/^Error:\s*/, '');

// ---------- icons ----------
const P = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-9"/>',
  list: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z" transform="translate(0 0)"/><path d="M9.5 9h5M9.5 12.5h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  leaf: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5Z"/><path d="M12 15c0-3-2.2-5-5.5-5 0 3 2.2 5 5.5 5Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5"/><path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.5 2.8 2 3 4.2"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  logout: '<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.4"/>',
  insta: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6"/>',
  fb: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15a2.5 2.5 0 0 1-2-2.5Z"/>',
  store: '<path d="M4 9.5 5.5 5h13L20 9.5"/><path d="M4 9.5a2.6 2.6 0 0 0 5.3 0 2.6 2.6 0 0 0 5.4 0 2.6 2.6 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20"/>',
  dots: '<circle cx="6.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="17.5" cy="12" r="1.2"/>',
  truck: '<path d="M3 6.5h11V16H3zM14 9.5h3.8L21 13v3h-7"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  cash: '<rect x="3.5" y="6.5" width="17" height="11" rx="3"/><circle cx="12" cy="12" r="2.4"/>',
  receipt: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z"/><path d="M9.5 9h5M9.5 12.5h3"/>',
  share: '<path d="M12 15V4M8 7.5 12 4l4 3.5"/><path d="M6 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H18"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5 3 3L15 13l4 4"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  alert: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4M12 16.8v.2"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h8a6 6 0 0 1 0 12" transform="translate(0 -4)"/>',
  box: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7"/>',
  print: '<path d="M7 9V4h10v5M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 14h10v6H7z"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 10h16M10 10v9"/>',
  refresh: '<path d="M19 8a7.5 7.5 0 0 0-13-1.5L4.5 8M4.5 4v4h4M5 16a7.5 7.5 0 0 0 13 1.5l1.5-1.5M19.5 20v-4h-4"/>',
  phone: '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2 2A14.5 14.5 0 0 1 4.5 6a2 2 0 0 1 2-2Z"/>',
  pin: '<path d="M12 21s6-5.5 6-10.5a6 6 0 0 0-12 0C6 15.5 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/>',
  paste: '<rect x="6" y="5" width="12" height="15" rx="2.5"/><path d="M9.5 5V4h5v1M9.5 11h5M9.5 14.5h3"/>',
};
export function icon(name, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || '') + '</svg>'; }
export const chIcon = (c) => icon({ facebook: 'fb', instagram: 'insta', walkin: 'store' }[c] || 'dots');

// ---------- toast / busy ----------
let toastT = 0;
export function toast(msg, err, opts) {
  const t = $('#toast'); t.className = 'toast' + (err ? ' err' : '') + (opts && opts.cls ? ' ' + opts.cls : '');
  t.textContent = msg; t.hidden = false; t.onclick = (opts && opts.onclick) || null;
  clearTimeout(toastT);
  if (!(opts && opts.sticky)) toastT = setTimeout(() => { t.hidden = true; }, err ? 4800 : 2200);
}
let busyN = 0;
export function busy(msg) {
  busyN++; $('#busy-msg').textContent = msg || 'กำลังโหลด…'; $('#busy').hidden = false;
  let done = false;
  return () => { if (done) return; done = true; busyN--; if (busyN <= 0) { busyN = 0; $('#busy').hidden = true; } };
}
export async function withBusy(msg, p) { const end = busy(msg); try { return await p; } finally { end(); } }

// ---------- sheets ----------
const sheets = [];
export function openSheet(o) {
  const layer = document.createElement('div'); layer.className = 'layer';
  layer.innerHTML = '<div class="sheet' + (o.dlg ? ' dlg' : '') + '" role="dialog" aria-modal="true"><div class="sheet-h"><h2></h2><button class="xbtn" aria-label="ปิด">' + icon('close') + '</button></div><div class="sheet-b"></div><div class="sheet-f" hidden></div></div>';
  $('#layers').appendChild(layer);
  const s = { el: layer, body: $('.sheet-b', layer), foot: $('.sheet-f', layer), live: !!o.live, closed: false, data: o.data || {} };
  const h2 = $('h2', layer);
  s.setTitle = (t) => { h2.textContent = t; };
  s.setTitle(o.title || '');
  s.close = () => {
    if (s.closed) return; s.closed = true;
    const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1);
    layer.classList.add('closing'); layer.classList.remove('in');
    setTimeout(() => layer.remove(), 230);
    document.body.classList.toggle('noscroll', sheets.length > 0);
    if (o.onClose) o.onClose();
  };
  s.render = () => { if (s.closed) return; const st = s.body.scrollTop; o.build(s); s.foot.hidden = !s.foot.innerHTML.trim(); s.body.scrollTop = st; };
  $('.xbtn', layer).onclick = s.close;
  layer.addEventListener('mousedown', (e) => { if (e.target === layer && !o.sticky) s.close(); });
  sheets.push(s); document.body.classList.add('noscroll');
  s.render();
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
  return s;
}
export const topSheet = () => sheets[sheets.length - 1];
export const closeAllSheets = () => sheets.slice().forEach((s) => s.close());
export function refreshLiveSheets() { const t = topSheet(); sheets.forEach((s) => { if (s.live && (s === t || sheets.indexOf(s) < sheets.length - 1)) s.render(); }); }

// dialog = small sheet with cancel / ok. onOk(d) returns false to stay open.
export function dialog(title, bodyHtml, okLabel, onOk, opt) {
  opt = opt || {};
  const d = openSheet({
    title, dlg: true, sticky: !!opt.sticky,
    build(s) {
      s.body.innerHTML = bodyHtml;
      s.foot.innerHTML = (opt.noCancel ? '' : '<button class="btn ghost" data-x="c">' + esc(opt.cancel || 'ยกเลิก') + '</button>') + (okLabel ? '<button class="btn ' + (opt.danger ? 'warn' : '') + '" data-x="ok">' + esc(okLabel) + '</button>' : '');
    },
  });
  d.foot.onclick = (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'c') return d.close();
    const r = onOk && onOk(d);
    if (r === false) return;
    if (r && typeof r.then === 'function') r.then((v) => { if (v !== false) d.close(); }, (er) => toast(errMsg(er), true));
    else d.close();
  };
  return d;
}
export const confirmDlg = (title, msg, label, fn) => dialog(title, '<p>' + esc(msg) + '</p>', label, fn, { danger: true });

// event delegation helper: data-act="name" → handlers[name](dataset, target, event)
export function bind(root, handlers) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const h = handlers[t.dataset.act];
    if (h) h(t.dataset, t, e);
  });
}

// ---------- pills ----------
export const isActive = (o) => o.status !== 'cancelled';
export const isOver = (o) => isActive(o) && o.ship_status === 'pending' && !!str(o.ship_date) && str(o.ship_date) < today();
export const depositOnly = (o) => o.payment_status === 'partial' && num(o.deposit_amount) > 0 && num(o.paid_amount) - num(o.deposit_amount) <= 0.005;
export const pill = (cls, t) => '<span class="pill p-' + cls + '">' + esc(t) + '</span>';
export function payPill(o) {
  if (o.payment_status === 'paid') return pill('mint', 'จ่ายแล้ว');
  if (depositOnly(o)) return pill('lilac', 'มัดจำแล้ว');
  if (o.payment_status === 'partial') return pill('peach', 'จ่ายบางส่วน');
  return pill('butter', 'รอจ่าย');
}
export function shipPill(o) {
  if (o.ship_status === 'shipped') return pill('gm', 'ส่งแล้ว');
  return isOver(o) ? pill('rose', 'เลยกำหนด') : pill('sky', 'รอส่ง');
}
export const orderPills = (o) => (isActive(o) ? payPill(o) + shipPill(o) : pill('grey', 'ยกเลิก'));
export const balanceOf = (o) => num(o.total) - num(o.paid_amount);
export function findOrder(id) { return ctx.store.getOrder(id) || ctx.extra.get(id) || null; }
ctx.extra = new Map();

// ---------- files ----------
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function canShareFile(file) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (e) { return false; } }
export async function shareOrDownload(blob, name, type) {
  const file = new File([blob], name, { type: type || blob.type });
  if (canShareFile(file)) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  downloadBlob(blob, name); return 'download';
}
export function thumbHTML(p, cls) {
  return '<span class="thumb' + (cls ? ' ' + cls : '') + '">' + (p && p.thumb ? '<img alt="" decoding="async" src="' + esc(p.thumb) + '">' : icon('leaf')) + '</span>';
}
export function emptyHTML(em, title, text, btn, act) {
  return '<div class="empty fade-in"><div class="em">' + em + '</div><div class="t">' + esc(title) + '</div>' + (text ? '<p>' + esc(text) + '</p>' : '<p></p>') + (btn ? '<button class="btn" data-act="' + act + '">' + esc(btn) + '</button>' : '') + '</div>';
}
export function moreBtn(act, label) { return '<div class="more"><button class="btn sec sm" data-act="' + act + '">' + esc(label || 'แสดงเพิ่ม') + '</button></div>'; }
