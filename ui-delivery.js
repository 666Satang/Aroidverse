// Delivery method (ไปรษณีย์ / Lalamove / นัดรับ) + pickup places: pills, form field, place editor (SPEC9 §1).
import { ctx, $, esc, str, icon, toast, errMsg, dialog } from './ui-core.js';

export const METHODS = [['post', 'ไปรษณีย์'], ['lalamove', 'Lalamove'], ['pickup', 'นัดรับ']];
export const PK_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
const PK_TH = { red: 'แดง', orange: 'ส้ม', yellow: 'เหลือง', green: 'เขียว', teal: 'เขียวน้ำทะเล', blue: 'น้ำเงิน', purple: 'ม่วง', pink: 'ชมพู', grey: 'เทา' };
const DEFAULT_PLACES = [{ id: 'jj', name: 'JJ', color: 'red' }, { id: 'sj', name: 'เซนแจ้ง', color: 'yellow' }];
export const pkColor = (c) => (PK_COLORS.indexOf(c) >= 0 ? c : 'grey');

export function places() {
  let l = null;
  try { const S = ctx.store; l = S.pickupPlaces ? S.pickupPlaces() : S.state.settings.pickup_places; } catch (e) { l = null; }
  if (!Array.isArray(l)) l = DEFAULT_PLACES;
  return l.filter((p) => p && p.id).map((p) => ({ id: String(p.id), name: str(p.name), color: pkColor(p.color) }));
}
export const methodOf = (o) => (o && METHODS.some((m) => m[0] === o.delivery_method) ? o.delivery_method : '');
export const isPickup = (o) => methodOf(o) === 'pickup';
export const methodLabel = (m) => { const x = METHODS.find((k) => k[0] === m); return x ? x[1] : ''; };
// place of a pickup order: live place first, then the snapshot name
export function placeOf(o) {
  const p = places().find((x) => x.id === str(o.pickup_place_id));
  return p ? { id: p.id, name: p.name, color: p.color, found: true } : { id: str(o.pickup_place_id), name: str(o.pickup_place_name), color: 'grey', found: false };
}
export function methodPill(o) {
  const m = methodOf(o); if (!m) return '';
  if (m === 'pickup') { const p = placeOf(o); return '<span class="pill pm pk-' + p.color + '">' + icon('pin') + '<span class="trunc">' + esc(p.name || 'นัดรับ') + '</span></span>'; }
  return '<span class="pill pm p-gm">' + icon(m === 'post' ? 'mail' : 'bike') + '<span>' + esc(methodLabel(m)) + '</span></span>';
}
// does this order belong to the sub-filter key ('all' | 'post' | 'lalamove' | 'pickup' | 'pk:<id>' | 'none')
export function methodMatch(o, key) {
  if (!key || key === 'all') return true;
  const m = methodOf(o);
  if (key === 'none') return !m;
  if (key.indexOf('pk:') === 0) return m === 'pickup' && str(o.pickup_place_id) === key.slice(3);
  return m === key;
}

// ---------- colour swatches ----------
export function swatchesHTML(sel) {
  return '<div class="swatches" role="radiogroup" aria-label="สี">' + PK_COLORS.map((c) => '<button type="button" class="sw' + (c === sel ? ' on' : '') + '" data-sw="' + c + '" role="radio" aria-checked="' + (c === sel) + '" aria-label="' + PK_TH[c] + '"><i style="background:var(--pk-' + c + ')"></i></button>').join('') + '</div>';
}
function bindSwatches(root, get, set) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]'); if (!b || !root.contains(b)) return;
    set(b.dataset.sw);
    root.querySelectorAll('[data-sw]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  });
}

// ---------- method field (new-order form + edit dialog) ----------
// m = {method, place, snap}; onChange(m) is called after every change. Re-renders only its own host.
export function mountMethodField(host, m, onChange) {
  const S = ctx.store;
  const add = { open: false, name: '', color: 'green' };
  const chip = (p) => '<button type="button" class="pkchip pk-' + p.color + (m.place === p.id ? ' on' : '') + '" data-mf="pl" data-id="' + esc(p.id) + '" aria-pressed="' + (m.place === p.id) + '"><i></i><span class="trunc">' + esc(p.name) + '</span></button>';
  function draw() {
    const pl = places(), known = pl.some((p) => p.id === m.place);
    let h = '<div class="seg" role="group" aria-label="วิธีส่ง">' + METHODS.map((x) => '<button type="button" data-mf="m" data-v="' + x[0] + '" class="' + (m.method === x[0] ? 'on' : '') + '" aria-pressed="' + (m.method === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
    if (m.method === 'pickup') {
      h += '<div class="pkchips">' + pl.map(chip).join('') + (m.place && !known ? '<button type="button" class="pkchip pk-grey on" data-mf="pl" data-id="' + esc(m.place) + '"><i></i><span class="trunc">' + esc(m.snap || 'สถานที่ที่ลบแล้ว') + '</span></button>' : '') +
        (add.open ? '' : '<button type="button" class="pkchip addp" data-mf="addo">+ เพิ่มสถานที่</button>') + '</div>';
      if (add.open) h += '<div class="pkadd"><label class="fld" style="margin-top:0">ชื่อสถานที่นัดรับ</label><input data-mf="name" maxlength="40" value="' + esc(add.name) + '" placeholder="เช่น สยาม / ที่บ้าน" autocomplete="off">' + swatchesHTML(add.color) + '<div class="grid2" style="margin-top:12px"><button type="button" class="btn ghost sm" data-mf="addc">ยกเลิก</button><button type="button" class="btn sm" data-mf="adds">เพิ่มและเลือก</button></div></div>';
      else if (!pl.length) h += '<div class="sub" style="margin-top:8px">ยังไม่มีสถานที่ — กด "+ เพิ่มสถานที่"</div>';
    }
    host.innerHTML = h;
    if (add.open) { const i = $('[data-mf="name"]', host); if (i && add.focus) { add.focus = false; i.focus(); } }
  }
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mf]'); if (!t || !host.contains(t)) return;
    const k = t.dataset.mf;
    if (k === 'm') { m.method = m.method === t.dataset.v ? '' : t.dataset.v; if (m.method !== 'pickup') { m.place = ''; add.open = false; } draw(); onChange(m); }
    else if (k === 'pl') { m.place = t.dataset.id; draw(); onChange(m); }
    else if (k === 'addo') { add.open = true; add.focus = true; draw(); }
    else if (k === 'addc') { add.open = false; draw(); }
    else if (k === 'adds') {
      const name = add.name.trim(); if (!name) { toast('กรุณาใส่ชื่อสถานที่', true); const i = $('[data-mf="name"]', host); if (i) i.focus(); return; }
      S.savePickupPlace({ name, color: add.color }).then((p) => { m.place = p.id; add.open = false; add.name = ''; draw(); onChange(m); toast('เพิ่มสถานที่แล้ว'); }, (er) => toast(errMsg(er), true));
    }
  });
  host.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.mf === 'name') add.name = e.target.value; });
  bindSwatches(host, () => add.color, (c) => { add.color = c; });
  draw();
  return { redraw: draw };
}

// ---------- place editor (settings) ----------
export function openPlaceDialog(place) {
  const S = ctx.store, p = place || { name: '', color: 'green' };
  let color = pkColor(p.color);
  const d = dialog(place ? 'แก้ไขสถานที่นัดรับ' : 'เพิ่มสถานที่นัดรับ', '<label class="fld">ชื่อสถานที่</label><input id="pl-name" maxlength="40" value="' + esc(p.name) + '" placeholder="เช่น JJ / สยาม" autocomplete="off"><label class="fld">สี</label><div id="pl-sw">' + swatchesHTML(color) + '</div>' +
    (place ? '<p class="sub">ออเดอร์เก่าจะยังแสดงชื่อเดิมจนกว่าจะบันทึกออเดอร์นั้นใหม่</p>' : ''), 'บันทึก', (dd) => {
    const name = $('#pl-name', dd.el).value.trim(); if (!name) { toast('กรุณาใส่ชื่อสถานที่', true); return false; }
    return S.savePickupPlace({ id: place ? place.id : undefined, name, color }).then(() => { toast('บันทึกสถานที่แล้ว'); });
  });
  bindSwatches($('#pl-sw', d.el), () => color, (c) => { color = c; });
  return d;
}

// ---------- settings section ----------
export function placesCardHTML() { return '<div class="card" id="s-places"><div class="h3">สถานที่นัดรับ</div><div id="s-pl-list"></div><button class="btn sec block" id="s-pl-add" type="button" style="margin-top:10px">' + icon('plus') + ' เพิ่มสถานที่</button><p class="sub" style="margin-top:10px">บันทึกทันทีที่แก้ไข (ไม่ต้องกดบันทึกการตั้งค่า) · ออเดอร์เก่ายังเก็บชื่อสถานที่ไว้แม้จะลบหรือเปลี่ยนชื่อที่นี่</p></div>'; }
export function mountPlacesCard(el) {
  const S = ctx.store, list = $('#s-pl-list', el); if (!list) return null;
  const draw = () => {
    const pl = places();
    list.innerHTML = pl.length ? pl.map((p, i) => '<div class="plrow"><button type="button" class="plmain" data-pl="edit" data-id="' + esc(p.id) + '" aria-label="แก้ไข ' + esc(p.name) + '"><span class="pkdot pk-' + p.color + '"><i></i></span><span class="grow trunc nm">' + esc(p.name) + '</span>' + icon('edit', 'ed') + '</button>' +
      '<button type="button" class="xbtn" data-pl="up" data-id="' + esc(p.id) + '" aria-label="เลื่อนขึ้น"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
      '<button type="button" class="xbtn" data-pl="down" data-id="' + esc(p.id) + '" aria-label="เลื่อนลง"' + (i === pl.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
      '<button type="button" class="xbtn" data-pl="del" data-id="' + esc(p.id) + '" aria-label="ลบ ' + esc(p.name) + '">' + icon('trash') + '</button></div>').join('') : '<div class="sub" style="padding:6px 2px">ยังไม่มีสถานที่นัดรับ</div>';
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('#s-pl-add,[data-pl]'); if (!t || !el.contains(t)) return;
    if (t.id === 's-pl-add') return openPlaceDialog(null);
    const p = places().find((x) => x.id === t.dataset.id); if (!p) return;
    const k = t.dataset.pl;
    if (k === 'edit') openPlaceDialog(p);
    else if (k === 'up' || k === 'down') S.movePickupPlace(p.id, k === 'up' ? -1 : 1).catch((er) => toast(errMsg(er), true));
    else if (k === 'del') dialog('ลบสถานที่ “' + p.name + '”?', '<p>ออเดอร์เก่าที่นัดรับที่นี่จะยังแสดงชื่อ “' + esc(p.name) + '” ตามที่บันทึกไว้ (เป็นสีเทา)</p>', 'ลบสถานที่', () => S.deletePickupPlace(p.id).then(() => { toast('ลบสถานที่แล้ว'); }), { danger: true });
  });
  draw();
  return draw;
}
