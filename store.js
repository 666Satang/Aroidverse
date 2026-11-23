// store.js — all business logic + in-memory state for Plant Orders v3.
// Plain ES module, no dependencies. Talks to an adapter (adapter-mock.js / adapter-fire.js).
// Every action: validate (throws Thai Error before any change) -> apply to memory synchronously ->
// ONE adapter.commit(ops) -> notify subscribers. Nothing here ever awaits the network inside an action.

const TZ = 'Asia/Bangkok';
export const CHANNELS = ['facebook', 'instagram', 'walkin', 'other'];
export const PAY_TYPES = ['deposit', 'payment', 'refund'];
export const WALKIN_NAME = 'ลูกค้าหน้าร้าน';
export const EXPENSE_CATEGORIES = ['ค่าที่', 'วัสดุสิ้นเปลือง', 'ค่าขนส่ง', 'ค่าการตลาด', 'ค่าแรง', 'อื่นๆ'];
export const DEFAULT_SETTINGS = {
  shop_name: 'My Plant Shop',
  bank_name: 'Kasikorn Bank (KBank)',
  bank_account_no: '',
  bank_account_name: '',
  contact_email: '',
  currency: 'THB',
  invoice_prefix: 'INV',
  invoice_note: 'Thank you for your order!',
  gemini_api_key: '',
  gemini_model: 'gemini-flash-latest',
  bridge_url: '',
  bridge_token: '',
  reminder_hour: 9,
  calendar_enabled: true,
  legacy_imported: false,
  push_vapid_key: '',
  push_before_enabled: true,
  push_before_time: '18:00',
  push_day_enabled: true,
  push_day_time: '08:00',
  label_width_mm: 50,
  label_height_mm: 50,
  label_dpi: 300,
  label_rotate: false,
  label_show_sender: false,
  label_sender_phone: '',
  label_sender_address: '',
  label_show_order_no: true,
  printer_task: '',
  printer_density: 3,
  printer_direction: 'top',
  printer_label_type: 1,
  printer_auto_print: true,
  push_time_enabled: true,
  push_time_lead_min: 120
};
const LEGACY_SETTING_KEYS = ['shop_name', 'bank_name', 'bank_account_no', 'bank_account_name', 'contact_email', 'currency', 'invoice_prefix', 'invoice_note', 'gemini_api_key', 'gemini_model'];
export const DELIVERY_METHODS = ['post', 'lalamove', 'pickup'];
export const DELIVERY_LABELS = { post: 'ไปรษณีย์', lalamove: 'Lalamove', pickup: 'นัดรับ' };
export const PLACE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
export const DEFAULT_PICKUP_PLACES = [{ id: 'jj', name: 'JJ', color: 'red' }, { id: 'sj', name: 'เซนแจ้ง', color: 'yellow' }];
const THUMB_MAX = 12000;          // chars of a thumb data-URL accepted on an order item
const ITEM_FULL_MAX = 900000;     // chars of a full item photo (Firestore doc limit is 1 MiB)
const PAGE = 50;
const LS_SYNC = 'plantapp_customers_sync';

// ---------------------------------------------------------------------------
// Pure helpers (exported)
// ---------------------------------------------------------------------------
let _dtf = null;
export function todayStr(d) {
  if (!_dtf) _dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = {};
  _dtf.formatToParts(d || new Date()).forEach(p => { parts[p.type] = p.value; });
  return parts.year + '-' + parts.month + '-' + parts.day;
}
export function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
export function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
export function num(v, def) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : def;
}
export function normChannel(c) {
  c = str(c).toLowerCase();
  if (!c) return 'facebook';
  return CHANNELS.indexOf(c) >= 0 ? c : 'other';
}
export function payStatus(total, paid) {
  if (total <= 0) return 'paid';
  if (paid >= total - 0.004) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}
export function summarizeItems(items) {
  return (items || []).map(i => i.name + (i.code ? ' (' + i.code + ')' : '') + ' x' + i.qty).join('; ');
}
export function ymOf(dateStr) { return String(dateStr || '').slice(0, 7); }
function assertDate(v) {
  const s = str(v);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง: ' + s);
  return s;
}
export function normTime(v) {
  const s = str(v);
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('รูปแบบเวลาไม่ถูกต้อง: ' + s);
  return pad(Number(m[1]), 2) + ':' + m[2];
}
// cost value: '' / null / undefined / NaN -> null, else a number >= 0 (rounded to 2 decimals)
function costVal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, null);
  if (n === null) return null;
  if (n < 0) throw new Error('ต้นทุนต้องไม่ติดลบ');
  return round2(n);
}
function codeNum(code) { const n = parseInt(String(code || '').replace(/\D+/g, ''), 10); return Number.isFinite(n) ? n : 0; }
function pad(n, d) { let s = String(n); while (s.length < d) s = '0' + s; return s; }

// Recompute every derived field of an order (totals, payments aggregate, status, open flag...).
export function deriveOrder(o) {
  const items = (o.items || []).map(i => Object.assign({
    plant_id: i.plant_id || '', code: i.code || '', name: i.name, unit_price: round2(i.unit_price), qty: i.qty,
    unit_cost: (i.unit_cost === undefined || i.unit_cost === null || i.unit_cost === '' || !Number.isFinite(Number(i.unit_cost))) ? null : round2(Math.max(0, Number(i.unit_cost)))
  }, i.photo_id ? { photo_id: String(i.photo_id), thumb: String(i.thumb || '') } : null));
  const subtotal = round2(items.reduce((s, i) => s + i.unit_price * i.qty, 0));
  const shipping_fee = round2(Math.max(0, num(o.shipping_fee, 0)));
  const discount = round2(Math.max(0, num(o.discount, 0)));
  const total = round2(Math.max(0, subtotal + shipping_fee - discount));
  const payments = (o.payments || []).map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.date === b.p.date ? a.i - b.i : (a.p.date < b.p.date ? -1 : 1))).map(x => x.p);
  let paid = 0, dep = 0, last = '';
  const yms = [];
  payments.forEach(p => {
    paid += p.amount;
    if (p.type === 'deposit') dep += p.amount;
    if (p.date > last) last = p.date;
    const ym = ymOf(p.date);
    if (ym && yms.indexOf(ym) < 0) yms.push(ym);
  });
  const paid_amount = round2(Math.max(0, paid));
  const deposit_amount = round2(Math.max(0, dep));
  const payment_status = payStatus(total, paid_amount);
  const status = o.status === 'cancelled' ? 'cancelled' : 'active';
  const cost_total = round2(items.reduce((s, i) => s + (i.unit_cost === null ? 0 : i.unit_cost * i.qty), 0));
  const cost_missing = items.filter(i => i.unit_cost === null).length;
  const rawShipCost = (o.shipping_cost === undefined || o.shipping_cost === null || o.shipping_cost === '') ? null : num(o.shipping_cost, null);
  const shipping_cost = rawShipCost === null ? null : round2(Math.max(0, rawShipCost));
  const shipping_cost_eff = shipping_cost === null ? shipping_fee : shipping_cost;
  const profit = round2(total - cost_total - shipping_cost_eff);
  const ship_status = o.ship_status === 'shipped' ? 'shipped' : 'pending';
  return Object.assign({}, o, {
    items, items_summary: summarizeItems(items), subtotal, shipping_fee, discount, total,
    payments, pay_yms: yms, paid_amount, deposit_amount, payment_status,
    paid_date: paid_amount > 0 ? last : '',
    ship_status, status, ym: ymOf(o.order_date),
    ship_time: str(o.ship_time), shipping_cost, cost_total, cost_missing, shipping_cost_eff, profit,
    open: status === 'active' && (payment_status !== 'paid' || ship_status === 'pending')
  });
}

function addDaysStr(ds, n) {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 'overdue' | 'today' | 'tomorrow' | '' — only for active orders still waiting to ship with a ship_date
export function shipUrgency(order, today) {
  const o = order || {};
  if (o.status === 'cancelled' || o.ship_status === 'shipped') return '';
  const sd = String(o.ship_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return '';
  if (sd < today) return 'overdue';
  if (sd === today) return 'today';
  if (sd === addDaysStr(today, 1)) return 'tomorrow';
  return '';
}
// 'done' | 'urgent' | 'open' | 'cancelled'
export function orderTone(order, today) {
  const o = order || {};
  if (o.status === 'cancelled') return 'cancelled';
  if (o.payment_status === 'paid' && o.ship_status === 'shipped') return 'done';
  if (shipUrgency(o, today)) return 'urgent';
  return 'open';
}

function emptyMonthRow(month, year) {
  return {
    month, ym: year + '-' + pad(month, 2), orders: 0, plants: 0, sales: 0, facebook: 0, instagram: 0, walkin: 0, other: 0, received: 0, outstanding: 0, cancelled: 0,
    cogs: 0, shipping_cost: 0, shipping_fee: 0, gross_profit: 0, expenses: 0, net_profit: 0, cost_missing: 0
  };
}
const REPORT_KEYS = ['orders', 'plants', 'sales', 'facebook', 'instagram', 'walkin', 'other', 'received', 'outstanding', 'cancelled',
  'cogs', 'shipping_cost', 'shipping_fee', 'gross_profit', 'expenses', 'net_profit', 'cost_missing'];
const DAY_KEYS = ['orders', 'plants', 'sales', 'cogs', 'shipping_cost', 'gross_profit', 'received', 'cost_missing'];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export function createStore(adapter, opts) {
  opts = opts || {};
  const nowFn = opts.now || (() => new Date());
  const nowIso = () => nowFn().toISOString();
  const today = () => todayStr(nowFn());
  const DELETE = adapter.DELETE;

  const plants = new Map();
  const customers = new Map();
  const orders = new Map();
  const expenses = new Map();
  let counters = {};
  let settingsDoc = null;
  const photoCache = new Map();
  const photoInflight = new Map();
  const itemPhotoCache = new Map();
  const itemPhotoInflight = new Map();

  const state = {
    ready: false, online: true, pending: false, today: today(),
    settings: Object.assign({}, DEFAULT_SETTINGS),
    plants: [], customers: [], orders: [], expenses: [], hasMoreOrders: true, hasMoreSold: true
  };

  const subs = new Set();
  const localCbs = new Set();
  const errHandlers = new Set();
  let notifyQueued = false;
  let localVer = 0;
  const reportMemo = new Map();

  let started = false;
  let startPromise = null;
  const unsubs = [];
  let monthUnsubs = [];
  let currentYm = '';
  let timer = null;
  const pendingFlags = {};
  let lastSync = '';
  let orderCursor = null;       // oldest order_date seen via pagination
  let ordersInflight = null;
  let soldCursor = null;
  let soldInflight = null;
  let errHooked = false;

  // ----- state plumbing ----------------------------------------------------
  function rebuild() {
    state.plants = Array.from(plants.values()).filter(p => p.name).sort((a, b) => codeNum(b.code) - codeNum(a.code));
    state.customers = Array.from(customers.values()).filter(c => !c.deleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    state.orders = Array.from(orders.values()).sort((a, b) => {
      if (a.order_date !== b.order_date) return a.order_date < b.order_date ? 1 : -1;
      return codeNum(b.code) - codeNum(a.code);
    });
    state.expenses = sortExpenses(Array.from(expenses.values()).filter(e => !e.deleted));
  }
  function sortExpenses(list) {
    return list.slice().sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (String(a.created_at || '') < String(b.created_at || '') ? 1 : (String(a.created_at || '') > String(b.created_at || '') ? -1 : 0))));
  }
  function changed(local) {
    if (local) { localVer++; reportMemo.clear(); }
    rebuild();
    if (notifyQueued) return;
    notifyQueued = true;
    Promise.resolve().then(() => {
      notifyQueued = false;
      subs.forEach(fn => { try { fn(); } catch (e) { if (typeof console !== 'undefined') console.error(e); } });
    });
  }
  function recomputeSettings() { state.settings = Object.assign({}, DEFAULT_SETTINGS, settingsDoc || {}); }
  function applyPatch(obj, patch) {
    Object.keys(patch).forEach(k => { if (patch[k] === DELETE) delete obj[k]; else obj[k] = patch[k]; });
    return obj;
  }
  function mergeCounters(src) {
    if (!src) return;
    ['plant', 'customer', 'order'].forEach(k => { if (typeof src[k] === 'number' && src[k] > (counters[k] || 0)) counters[k] = src[k]; });
    if (src.inv) {
      counters.inv = counters.inv || {};
      Object.keys(src.inv).forEach(k => { if (src.inv[k] > (counters.inv[k] || 0)) counters.inv[k] = src.inv[k]; });
    }
    if (src.gone) { counters.gone = Object.assign({}, counters.gone || {}, src.gone); }
  }
  function mapOf(col) { return col === 'plants' ? plants : (col === 'customers' ? customers : (col === 'expenses' ? expenses : orders)); }
  function upsert(col, d) {
    if (!d || !d.id) return false;
    const map = mapOf(col);
    const local = map.get(d.id);
    if (local) {
      const ghost = col === 'plants' && !local.name;
      if (!ghost && local.updated_at) {
        if (d.updated_at && d.updated_at < local.updated_at) return false;
        if (d.updated_at === local.updated_at) return false;
      }
    }
    map.set(d.id, d);
    return true;
  }
  function maxStr(a, b) { return a > b ? a : b; }

  // ----- lookups -----------------------------------------------------------
  function getPlant(id) { const p = plants.get(id); return p && p.name ? p : null; }
  function getCustomer(id) { return customers.get(id) || null; }
  function getOrder(id) { return orders.get(id) || null; }
  function balance(o) { return round2((o.total || 0) - (o.paid_amount || 0)); }
  function findPlant(idOrCode) {
    const k = str(idOrCode);
    if (!k) return null;
    const p = getPlant(k);
    if (p) return p;
    const lk = k.toLowerCase();
    for (const q of plants.values()) if (q.name && String(q.code || '').toLowerCase() === lk) return q;
    return null;
  }
  function isGone(id) { return !!(counters.gone && counters.gone[id]); }
  function mustOrder(id) {
    const o = orders.get(id);
    if (!o) throw new Error('ไม่พบออเดอร์');
    return o;
  }
  function assertActive(o) { if (o.status === 'cancelled') throw new Error('ออเดอร์นี้ถูกยกเลิกแล้ว แก้ไขไม่ได้'); }

  // ----- stock helpers -----------------------------------------------------
  function stockPatch(plant, newQty, now) {
    const patch = { qty: newQty, in_stock: newQty > 0, updated_at: now };
    if (newQty > 0) { if (plant.sold_at) patch.sold_at = DELETE; }
    else patch.sold_at = (plant.qty <= 0 && plant.sold_at) ? plant.sold_at : now;
    return patch;
  }
  // sold_count adjustment (missing = 0, never below 0)
  function soldCountPatch(plant, delta) {
    const cur = Number(plant.sold_count) || 0;
    return { sold_count: Math.max(0, cur + delta) };
  }
  function stockErr(name, code, left, want, verb) {
    return new Error('สต็อกไม่พอ: ' + name + (code ? ' (' + code + ')' : '') + ' เหลือ ' + left + ' ต้น แต่' + verb + ' ' + want + ' ต้น');
  }

  // validate a {thumb, full, crop} (or re-crop {thumb, crop}) item photo; returns normalised values
  function checkItemPhoto(photo, allowRecrop) {
    const bad = () => new Error('ข้อมูลรูปไม่ถูกต้อง');
    if (!photo || typeof photo !== 'object' || typeof photo.thumb !== 'string' || photo.thumb.indexOf('data:image/') !== 0) throw bad();
    if (photo.thumb.length > THUMB_MAX) throw new Error('รูปย่อใหญ่เกินไป (เกิน 12 KB) กรุณาลดขนาดรูปย่อ');
    const recrop = allowRecrop && typeof photo.full !== 'string';
    if (!recrop) {
      if (typeof photo.full !== 'string' || photo.full.indexOf('data:image/') !== 0) throw bad();
      if (photo.full.length > ITEM_FULL_MAX) throw new Error('รูปใหญ่เกินไป');
    }
    return { thumb: photo.thumb, full: recrop ? null : photo.full, crop: photo.crop ? normCrop(photo.crop) : null, recrop };
  }
  function pickupPlaces() {
    const l = state.settings.pickup_places;
    const src = Array.isArray(l) ? l : DEFAULT_PICKUP_PLACES;
    return src.filter(p => p && p.id).map(p => ({ id: String(p.id), name: str(p.name), color: PLACE_COLORS.indexOf(p.color) >= 0 ? p.color : 'grey' }));
  }
  // resolve the delivery fields of an order: returns {delivery_method, pickup_place_id, pickup_place_name}
  function deliveryFields(method, placeId, prevOrder) {
    const m = str(method).toLowerCase();
    if (m !== '' && DELIVERY_METHODS.indexOf(m) < 0) throw new Error('วิธีส่งไม่ถูกต้อง');
    if (m !== 'pickup') return { delivery_method: m, pickup_place_id: '', pickup_place_name: '' };
    const id = str(placeId);
    if (!id) return { delivery_method: m, pickup_place_id: '', pickup_place_name: '' };
    const pl = pickupPlaces().find(x => x.id === id);
    let name = pl ? pl.name : '';
    if (!pl && prevOrder && prevOrder.pickup_place_id === id) name = str(prevOrder.pickup_place_name);
    return { delivery_method: m, pickup_place_id: id, pickup_place_name: name };
  }

  // Validate + normalise items. old = {plantId: qty} of the order being edited (null for new orders).
  function normItems(itemsIn, old, prev) {
    const used = new Set();
    if (!Array.isArray(itemsIn) || !itemsIn.length) throw new Error('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    const items = [];
    const need = {};
    const photoSets = [];
    // custom-line photos: claim previous photo_ids that the incoming lines refer to explicitly
    const prevPhoto = {};
    (prev || []).forEach(pv => { if (!pv.plant_id && pv.photo_id) prevPhoto[pv.photo_id] = pv; });
    const claimed = {};
    itemsIn.forEach(it => { it = it || {}; if (!str(it.plant_id) && !it.photo && it.photo !== false && it.photo_id && prevPhoto[it.photo_id] && !claimed[it.photo_id]) claimed[it.photo_id] = true; });
    itemsIn.forEach((it, i) => {
      it = it || {};
      const ref = str(it.plant_id);
      const qty = num(it.qty, 0);
      if (!(qty > 0)) throw new Error('จำนวนสินค้าไม่ถูกต้อง (รายการที่ ' + (i + 1) + ')');
      let plant = null, pid = '', code = str(it.code);
      if (ref) {
        plant = findPlant(ref);
        if (plant) { pid = plant.id; code = plant.code || ''; need[pid] = (need[pid] || 0) + qty; }
        else if (old && old.qty[ref] !== undefined) { pid = ref; code = code || old.code[ref] || ''; need[pid] = (need[pid] || 0) + qty; }
        else throw new Error('ไม่พบต้นไม้รหัส ' + ref + ' ในระบบ');
      }
      const name = str(it.name) || (plant ? plant.name : '');
      if (!name) throw new Error('กรุณาระบุชื่อสินค้า (รายการที่ ' + (i + 1) + ')');
      let price = (it.unit_price === undefined || it.unit_price === null || it.unit_price === '')
        ? (plant ? plant.price : 0) : num(it.unit_price, 0);
      if (price < 0) throw new Error('ราคาต้องไม่ติดลบ (' + name + ')');
      // unit_cost: explicit value wins; else keep the previous line's cost (edits) or snapshot the plant's cost
      let cost = costVal(it.unit_cost);
      if (cost === null) {
        let kept = false;
        if (prev) {
          for (let k = 0; k < prev.length; k++) {
            const pv = prev[k];
            if (used.has(k)) continue;
            if (pid ? pv.plant_id === pid : (!pv.plant_id && pv.name === name)) { used.add(k); kept = true; cost = pv.unit_cost === undefined ? null : pv.unit_cost; break; }
          }
        }
        if (!kept && plant) cost = plant.cost === undefined || plant.cost === null ? null : num(plant.cost, null);
      }
      const line = { plant_id: pid, code: pid ? code : '', name, unit_price: round2(price), qty, unit_cost: cost };
      if (!pid) {
        if (it.photo) {
          const ph = checkItemPhoto(it.photo, false);
          const phId = adapter.newId();
          photoSets.push({ id: phId, data: { data: ph.full, crop: ph.crop } });
          line.photo_id = phId; line.thumb = ph.thumb;
        } else if (it.photo !== false && prev) {
          let keep = null;
          if (it.photo_id && claimed[it.photo_id] === true) { keep = prevPhoto[it.photo_id]; claimed[it.photo_id] = 'used'; }
          else {
            for (let k = 0; k < prev.length; k++) {
              const pv = prev[k];
              if (pv.plant_id || !pv.photo_id || claimed[pv.photo_id] || pv.name !== name) continue;
              keep = pv; claimed[pv.photo_id] = 'used'; break;
            }
          }
          if (keep) { line.photo_id = keep.photo_id; line.thumb = keep.thumb || ''; }
        }
      }
      items.push(line);
    });
    const kept = {};
    items.forEach(l => { if (l.photo_id) kept[l.photo_id] = true; });
    const photoDeletes = Object.keys(prevPhoto).filter(k => !kept[k]);
    return { items, need, photoSets, photoDeletes };
  }

  // ----- commit helper -----------------------------------------------------
  function send(ops) {
    if (!ops.length) return;
    adapter.commit(ops);
    emitLocal(ops);
  }
  // report the ids touched by a local commit to onLocalChange listeners (derived from the ops)
  function emitLocal(ops) {
    if (!localCbs.size) return;
    const ev = { orders: [], plants: [], customers: [], expenses: [], deleted: { plants: [], customers: [], expenses: [] } };
    const add = (list, id) => { if (list.indexOf(id) < 0) list.push(id); };
    ops.forEach(o => {
      const m = /^(orders|plants|customers|expenses)\/([^/]+)$/.exec(o.path || '');
      if (!m) return;
      const col = m[1], id = m[2];
      if (o.op === 'delete') { if (col === 'plants' || col === 'customers' || col === 'expenses') add(ev.deleted[col], id); }
      else if ((col === 'customers' || col === 'expenses') && o.data && o.data.deleted === true) add(ev.deleted[col], id);
      else add(ev[col], id);
    });
    if (!ev.orders.length && !ev.plants.length && !ev.customers.length && !ev.expenses.length && !ev.deleted.plants.length && !ev.deleted.customers.length && !ev.deleted.expenses.length) return;
    localCbs.forEach(fn => { try { fn(ev); } catch (e) { if (typeof console !== 'undefined') console.error(e); } });
  }
  function onLocalChange(fn) { localCbs.add(fn); return () => localCbs.delete(fn); }
  function diff(oldObj, newObj) {
    const patch = {};
    Object.keys(newObj).forEach(k => {
      const a = oldObj[k], b = newObj[k];
      if (a === b) return;
      if (typeof b === 'object' && b !== null && typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b)) return;
      patch[k] = b;
    });
    return patch;
  }
  // Apply a changed order (already validated). extraOps are plant/counter ops built by the caller.
  function commitOrder(old, changes, extraOps) {
    const now = nowIso();
    const next = deriveOrder(Object.assign({}, old, changes, { updated_at: now }));
    const patch = diff(old, next);
    patch.updated_at = now;
    orders.set(old.id, next);
    send([{ op: 'merge', path: 'orders/' + old.id, data: patch }].concat(extraOps || []));
    changed(true);
    return next;
  }
  function counterOps(patch) {
    return Object.keys(patch).length ? [{ op: 'merge', path: 'meta/counters', data: patch }] : [];
  }

  // ----- settings ----------------------------------------------------------
  async function saveSettings(patch) {
    patch = patch || {};
    const data = {};
    Object.keys(patch).forEach(k => {
      if (k === 'id') return;
      const v = patch[k];
      data[k] = typeof v === 'string' ? v.trim() : (v === null || v === undefined ? '' : v);
    });
    settingsDoc = Object.assign({}, settingsDoc || {}, data);
    recomputeSettings();
    send([{ op: 'merge', path: 'settings/main', data }]);
    changed(true);
    return state.settings;
  }

  // ----- plants ------------------------------------------------------------
  function nextCodeFrom(map, key, prefix, digits, planCounters) {
    let max = Math.max(planCounters[key] || 0, 0);
    for (const e of map.values()) {
      const c = String(e.code || '');
      if (c.indexOf(prefix) === 0) { const n = parseInt(c.slice(prefix.length), 10); if (Number.isFinite(n) && n > max) max = n; }
    }
    planCounters[key] = max + 1;
    return prefix + pad(max + 1, digits);
  }

  async function savePlant(plant, photo) {
    plant = plant || {};
    const name = str(plant.name);
    if (!name) throw new Error('กรุณาระบุชื่อต้นไม้');
    const has = k => Object.prototype.hasOwnProperty.call(plant, k) && plant[k] !== undefined;
    const price = has('price') ? num(plant.price, 0) : null;
    const qty = has('qty') ? num(plant.qty, 1) : null;
    if (price !== null && price < 0) throw new Error('ราคาต้องไม่ติดลบ');
    if (qty !== null && (qty < 0 || !Number.isFinite(qty))) throw new Error('จำนวนต้องไม่ติดลบ');
    const cost = has('cost') ? costVal(plant.cost) : undefined;
    const recrop = !!(photo && typeof photo.full !== 'string' && photo.crop);
    if (photo && (typeof photo.thumb !== 'string' || (!recrop && typeof photo.full !== 'string'))) throw new Error('ข้อมูลรูปไม่ถูกต้อง');
    const crop = photo && photo.crop ? normCrop(photo.crop) : null;
    if (recrop && !str(plant.id)) throw new Error('ข้อมูลรูปไม่ถูกต้อง');
    const now = nowIso();
    const ops = [];
    const id = str(plant.id);
    let result;
    if (!id) {
      const pc = {};
      const code = nextCodeFrom(plants, 'plant', 'P', 4, Object.assign({}, counters));
      pc.plant = codeNum(code);
      const q = qty === null ? 1 : qty;
      const nid = adapter.newId();
      result = {
        id: nid, code, name, detail: str(plant.detail), price: price === null ? 0 : round2(price), qty: q, in_stock: q > 0,
        thumb: photo ? photo.thumb : '', has_photo: !!photo, note: str(plant.note), cost: cost === undefined ? null : cost, sold_count: 0, created_at: now, updated_at: now
      };
      if (q <= 0) result.sold_at = now;
      plants.set(nid, result);
      ops.push({ op: 'set', path: 'plants/' + nid, data: result });
      if (photo) ops.push({ op: 'set', path: 'plant_photos/' + nid, data: { data: photo.full, crop } });
      mergeCounters(pc);
      ops.push.apply(ops, counterOps(pc));
    } else {
      const cur = plants.get(id);
      if (!cur || !cur.name) throw new Error('ไม่พบต้นไม้รหัส ' + id);
      const patch = { name, updated_at: now };
      if (has('detail')) patch.detail = str(plant.detail);
      if (price !== null) patch.price = round2(price);
      if (has('note')) patch.note = str(plant.note);
      if (cost !== undefined) patch.cost = cost;
      if (qty !== null && qty !== cur.qty) Object.assign(patch, stockPatch(cur, qty, now));
      if (recrop && !cur.has_photo) throw new Error('ยังไม่มีรูปให้ครอป');
      if (photo) { patch.thumb = photo.thumb; patch.has_photo = true; }
      else if (photo === false) { patch.thumb = ''; patch.has_photo = false; }
      result = applyPatch(Object.assign({}, cur), patch);
      plants.set(id, result);
      ops.push({ op: 'merge', path: 'plants/' + id, data: patch });
      if (recrop) ops.push({ op: 'merge', path: 'plant_photos/' + id, data: { crop } });
      else if (photo) ops.push({ op: 'set', path: 'plant_photos/' + id, data: { data: photo.full, crop } });
      else if (photo === false) ops.push({ op: 'delete', path: 'plant_photos/' + id });
    }
    if (recrop) { const c = photoCache.get(result.id); if (c) photoCache.set(result.id, { data: c.data, crop }); }
    else if (photo) photoCache.set(result.id, { data: photo.full, crop });
    else if (photo === false) photoCache.set(result.id, null);
    send(ops);
    changed(true);
    return result;
  }

  async function deletePlant(id) {
    const cur = plants.get(id);
    if (!cur) throw new Error('ไม่พบต้นไม้รหัส ' + id);
    plants.delete(id);
    photoCache.delete(id);
    const pc = { gone: { [id]: true } };
    mergeCounters(pc);
    send([{ op: 'delete', path: 'plants/' + id }, { op: 'delete', path: 'plant_photos/' + id }].concat(counterOps(pc)));
    changed(true);
    return { ok: true };
  }

  // crop = {x, y, size} (fractions): square side = size * min(w,h); x,y = top-left as fraction of (w - side), (h - side). null = centred full square.
  function normCrop(c) {
    const f = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };
    const size = f(c && c.size, 1);
    return { x: f(c && c.x, 0.5), y: f(c && c.y, 0.5), size: size > 0.01 ? size : 0.01 };
  }
  function getPlantPhotoDoc(id) {
    if (photoCache.has(id)) return Promise.resolve(photoCache.get(id));
    const p = plants.get(id);
    if (p && p.name && !p.has_photo) return Promise.resolve(null);
    if (photoInflight.has(id)) return photoInflight.get(id);
    const pr = adapter.getDoc('plant_photos/' + id).then(d => {
      const v = d && d.data ? { data: d.data, crop: d.crop || null } : null;
      if (v) photoCache.set(id, v);
      return v;
    }).catch(() => null).then(v => { photoInflight.delete(id); return v; });
    photoInflight.set(id, pr);
    return pr;
  }
  function getPlantPhoto(id) { return getPlantPhotoDoc(id).then(d => (d ? d.data : null)); }

  // delete the full photos of plants sold more than `months` months ago (thumb stays)
  async function purgeOldPhotos(months) {
    const m = Number(months);
    if (!(m > 0)) throw new Error('จำนวนเดือนไม่ถูกต้อง');
    const d = nowFn();
    const cut = new Date(d.getTime());
    cut.setUTCMonth(cut.getUTCMonth() - Math.floor(m));
    const cutoff = cut.toISOString();
    const docs = await adapter.get({ col: 'plants', where: ['sold_at', '<', cutoff] });
    const now = nowIso();
    const ops = [];
    docs.forEach(doc => {
      if (!doc || !doc.id || !doc.has_photo || !doc.sold_at || doc.sold_at >= cutoff) return;
      const patch = { has_photo: false, updated_at: now };
      const cur = plants.get(doc.id);
      if (cur) plants.set(doc.id, applyPatch(Object.assign({}, cur), patch));
      photoCache.delete(doc.id);
      ops.push({ op: 'delete', path: 'plant_photos/' + doc.id });
      ops.push({ op: 'merge', path: 'plants/' + doc.id, data: patch });
    });
    if (ops.length) { send(ops); changed(true); }
    return ops.length / 2;
  }

  async function loadSoldPlants() {
    if (soldInflight) return soldInflight;
    const q = { col: 'plants', orderBy: ['sold_at', 'desc'], limit: PAGE };
    if (soldCursor) q.startAfter = soldCursor;
    soldInflight = adapter.get(q).then(docs => {
      docs.forEach(d => upsert('plants', d));
      if (docs.length) soldCursor = docs[docs.length - 1].sold_at || soldCursor;
      state.hasMoreSold = docs.length >= PAGE;
      changed(false);
    }).then(() => { soldInflight = null; }, e => { soldInflight = null; throw e; });
    return soldInflight;
  }

  function ensurePlant(id) {
    adapter.getDoc('plants/' + id).then(d => { if (d && upsert('plants', d)) changed(false); }).catch(() => {});
  }

  // ----- customers ---------------------------------------------------------
  async function saveCustomer(c) {
    c = c || {};
    const name = str(c.name);
    if (!name) throw new Error('กรุณาระบุชื่อลูกค้า');
    const now = nowIso();
    const id = str(c.id);
    const has = k => Object.prototype.hasOwnProperty.call(c, k) && c[k] !== undefined;
    let result;
    const ops = [];
    if (!id) {
      const pc = {};
      const code = nextCodeFrom(customers, 'customer', 'C', 4, Object.assign({}, counters));
      pc.customer = codeNum(code);
      const nid = adapter.newId();
      result = {
        id: nid, code, name, channel: normChannel(c.channel), contact: str(c.contact), phone: str(c.phone), country: str(c.country),
        address: str(c.address), note: str(c.note), deleted: false, created_at: now, updated_at: now
      };
      customers.set(nid, result);
      ops.push({ op: 'set', path: 'customers/' + nid, data: result });
      mergeCounters(pc);
      ops.push.apply(ops, counterOps(pc));
    } else {
      const cur = customers.get(id);
      if (!cur) throw new Error('ไม่พบลูกค้ารหัส ' + id);
      const patch = { name, updated_at: now };
      ['contact', 'phone', 'country', 'address', 'note'].forEach(k => { if (has(k)) patch[k] = str(c[k]); });
      if (has('channel')) patch.channel = normChannel(c.channel);
      result = Object.assign({}, cur, patch);
      customers.set(id, result);
      ops.push({ op: 'merge', path: 'customers/' + id, data: patch });
    }
    send(ops);
    changed(true);
    return result;
  }

  async function deleteCustomer(id) {
    const cur = customers.get(id);
    if (!cur) throw new Error('ไม่พบลูกค้ารหัส ' + id);
    const patch = { deleted: true, updated_at: nowIso() };
    const next = Object.assign({}, cur, patch);
    customers.set(id, next);
    send([{ op: 'merge', path: 'customers/' + id, data: patch }]);
    changed(true);
    return next;
  }

  // ----- orders: creation (shared by createOrder / createOrdersBatch) ------
  function newPlan() {
    return { now: nowIso(), today: today(), counters: { inv: Object.assign({}, counters.inv || {}) }, plantPatches: new Map(),
      newCustomers: [], orders: [], photoOps: [], scan: {}, prefix: str(state.settings.invoice_prefix) || 'INV' };
  }
  function scanMax(plan, key, map, prefix) {
    if (plan.scan[key] === undefined) {
      let max = counters[key] || 0;
      for (const e of map.values()) {
        const c = String(e.code || '');
        if (c.indexOf(prefix) === 0) { const n = parseInt(c.slice(prefix.length), 10); if (Number.isFinite(n) && n > max) max = n; }
      }
      plan.scan[key] = max;
    }
    return plan.scan[key];
  }
  function planNext(plan, key, map, prefix, digits) {
    const n = Math.max(plan.counters[key] || 0, scanMax(plan, key, map, prefix)) + 1;
    plan.counters[key] = n;
    return { n, code: prefix + pad(n, digits) };
  }
  function planInvoice(plan, orderDate) {
    const ym6 = orderDate.slice(0, 4) + orderDate.slice(5, 7);
    const pre = plan.prefix + '-' + ym6 + '-';
    let max = Math.max(plan.counters.inv[ym6] || 0, (counters.inv && counters.inv[ym6]) || 0);
    if (plan.scan['inv' + pre] === undefined) {
      let m = 0;
      for (const o of orders.values()) {
        const s = String(o.invoice_no || '');
        if (s.indexOf(pre) === 0) { const n = parseInt(s.slice(pre.length), 10); if (Number.isFinite(n) && n > m) m = n; }
      }
      plan.scan['inv' + pre] = m;
    }
    max = Math.max(max, plan.scan['inv' + pre]);
    plan.counters.inv[ym6] = max + 1;
    plan.scan['inv' + pre] = max + 1;
    return { ym6, n: max + 1, no: pre + pad(max + 1, 3) };
  }
  function planPlant(plan, id) {
    const cur = plants.get(id);
    if (!cur) return null;
    const p = plan.plantPatches.get(id);
    return p ? applyPatch(Object.assign({}, cur), p) : cur;
  }

  function buildOrder(plan, payload) {
    payload = payload || {};
    const ni = normItems(payload.items, null);
    const items = ni.items;
    Object.keys(ni.need).forEach(pid => {
      const p = planPlant(plan, pid);
      if (p.qty < ni.need[pid]) throw stockErr(p.name, p.code, p.qty, ni.need[pid], 'สั่ง');
    });
    // customer
    let customer = null, newCust = null;
    const cid = str(payload.customer_id);
    const nc = payload.new_customer;
    if (cid) {
      customer = customers.get(cid);
      if (!customer) throw new Error('ไม่พบลูกค้ารหัส ' + cid);
    } else if (nc && str(nc.name)) {
      newCust = { name: str(nc.name), channel: normChannel(nc.channel || payload.channel), contact: str(nc.contact), phone: str(nc.phone), country: str(nc.country), address: str(nc.address), note: str(nc.note) };
    }
    const channel = normChannel(str(payload.channel) || (customer ? customer.channel : '') || (newCust ? newCust.channel : '') || 'facebook');
    let customerName;
    if (customer) customerName = customer.name;
    else if (newCust) customerName = newCust.name;
    else if (channel === 'walkin') customerName = WALKIN_NAME;
    else throw new Error('กรุณาเลือกหรือเพิ่มลูกค้า');

    const orderDate = assertDate(payload.order_date) || plan.today;
    const shipDate = assertDate(payload.ship_date);
    const shipTime = normTime(payload.ship_time);
    const shippingCost = costVal(payload.shipping_cost);
    const shipping = round2(Math.max(0, num(payload.shipping_fee, 0)));
    const discount = round2(Math.max(0, num(payload.discount, 0)));
    const subtotal = round2(items.reduce((s, x) => s + x.unit_price * x.qty, 0));
    const total = round2(Math.max(0, subtotal + shipping - discount));
    const paid = round2(Math.max(0, num(payload.paid_amount, 0)));
    const dlv = deliveryFields(payload.delivery_method, payload.pickup_place_id, null);
    const shipped = payload.already_shipped === true || String(payload.already_shipped).toLowerCase() === 'true';
    let ptype = str(payload.paid_type).toLowerCase();
    if (ptype !== 'deposit' && ptype !== 'payment') ptype = paid < total ? 'deposit' : 'payment';

    // ---- no throws below this line: mutate the plan ----
    let custDoc = null;
    if (newCust) {
      const c = planNext(plan, 'customer', customers, 'C', 4);
      custDoc = Object.assign({ id: adapter.newId(), code: c.code }, newCust, { deleted: false, created_at: plan.now, updated_at: plan.now });
      plan.newCustomers.push(custDoc);
      customers.set(custDoc.id, custDoc); // visible to later payloads of the same batch (and rolled out with the plan)
      customer = custDoc;
    }
    const oc = planNext(plan, 'order', orders, 'O', 5);
    const inv = planInvoice(plan, orderDate);
    const id = adapter.newId();
    const order = deriveOrder({
      id, code: oc.code, invoice_no: inv.no, order_date: orderDate, customer_id: customer ? customer.id : '',
      customer_name: customerName, channel, items, shipping_fee: shipping, discount,
      payments: paid > 0 ? [{ id: adapter.newId(), date: orderDate, amount: paid, type: ptype, note: '' }] : [],
      ship_date: shipDate, ship_time: shipTime, shipping_cost: shippingCost, ship_status: shipped ? 'shipped' : 'pending', shipped_date: shipped ? orderDate : '',
      tracking_no: '', status: 'active', note: str(payload.note), created_at: plan.now, updated_at: plan.now,
      delivery_method: dlv.delivery_method, pickup_place_id: dlv.pickup_place_id, pickup_place_name: dlv.pickup_place_name
    });
    ni.photoSets.forEach(ps => { plan.photoOps.push({ op: 'set', path: 'item_photos/' + ps.id, data: ps.data }); itemPhotoCache.set(ps.id, { data: ps.data.data, crop: ps.data.crop }); });
    plan.orders.push(order);
    orders.set(id, order);
    Object.keys(ni.need).forEach(pid => {
      const p = planPlant(plan, pid);
      plan.plantPatches.set(pid, Object.assign({}, plan.plantPatches.get(pid) || {}, stockPatch(p, p.qty - ni.need[pid], plan.now), soldCountPatch(p, ni.need[pid])));
    });
    return order;
  }

  function finishPlan(plan) {
    const ops = [];
    plan.newCustomers.forEach(c => ops.push({ op: 'set', path: 'customers/' + c.id, data: c }));
    plan.orders.forEach(o => ops.push({ op: 'set', path: 'orders/' + o.id, data: o }));
    ops.push.apply(ops, plan.photoOps);
    plan.plantPatches.forEach((patch, pid) => {
      plants.set(pid, applyPatch(Object.assign({}, plants.get(pid)), patch));
      ops.push({ op: 'merge', path: 'plants/' + pid, data: patch });
    });
    const cp = {};
    ['customer', 'order'].forEach(k => { if (plan.counters[k] !== undefined) cp[k] = plan.counters[k]; });
    const inv = {};
    Object.keys(plan.counters.inv).forEach(k => { if (plan.counters.inv[k] > ((counters.inv && counters.inv[k]) || 0)) inv[k] = plan.counters.inv[k]; });
    if (Object.keys(inv).length) cp.inv = inv;
    mergeCounters(cp);
    ops.push.apply(ops, counterOps(cp));
    send(ops);
    changed(true);
  }
  // roll the temporary customer inserts of a plan back (used only when nothing is committed)
  function abortPlan(plan) { plan.newCustomers.forEach(c => customers.delete(c.id)); plan.orders.forEach(o => orders.delete(o.id)); }

  async function createOrder(payload) {
    const plan = newPlan();
    const order = buildOrder(plan, payload);
    finishPlan(plan);
    return order;
  }

  async function createOrdersBatch(payloads) {
    const res = { orders: [], errors: [] };
    if (!Array.isArray(payloads)) return res;
    const plan = newPlan();
    payloads.forEach((p, index) => {
      try { res.orders.push(buildOrder(plan, p)); }
      catch (e) { res.errors.push({ index, message: e && e.message ? e.message : String(e) }); }
    });
    if (plan.orders.length) finishPlan(plan); else abortPlan(plan);
    return res;
  }

  // ----- orders: edits -----------------------------------------------------
  async function updateOrder(id, patch) {
    patch = patch || {};
    const o = mustOrder(id);
    assertActive(o);
    const has = k => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
    const ch = {};
    if (has('ship_date')) ch.ship_date = assertDate(patch.ship_date);
    if (has('ship_time')) ch.ship_time = normTime(patch.ship_time);
    if (has('shipping_cost')) ch.shipping_cost = costVal(patch.shipping_cost);
    if (has('order_date')) {
      const od = assertDate(patch.order_date);
      if (!od) throw new Error('กรุณาระบุวันที่สั่งซื้อ');
      ch.order_date = od;
    }
    if (has('shipping_fee')) ch.shipping_fee = round2(Math.max(0, num(patch.shipping_fee, 0)));
    if (has('discount')) ch.discount = round2(Math.max(0, num(patch.discount, 0)));
    if (has('note')) ch.note = str(patch.note);
    if (has('tracking_no')) ch.tracking_no = str(patch.tracking_no);
    if (has('delivery_method') || has('pickup_place_id')) {
      const method = has('delivery_method') ? patch.delivery_method : o.delivery_method;
      const pid = has('pickup_place_id') ? patch.pickup_place_id : o.pickup_place_id;
      Object.assign(ch, deliveryFields(method, pid, o));
    }
    return commitOrder(o, ch);
  }

  async function updateOrderItems(id, itemsIn) {
    const o = mustOrder(id);
    assertActive(o);
    const old = { qty: {}, code: {}, name: {} };
    o.items.forEach(it => {
      if (it.plant_id) {
        old.qty[it.plant_id] = (old.qty[it.plant_id] || 0) + it.qty;
        old.code[it.plant_id] = it.code; old.name[it.plant_id] = it.name;
      }
    });
    const ni = normItems(itemsIn, old, o.items);
    const ids = {};
    Object.keys(old.qty).forEach(k => { ids[k] = true; });
    Object.keys(ni.need).forEach(k => { ids[k] = true; });
    const now = nowIso();
    const plantOps = [];
    const plantNew = [];
    const ensure = [];
    Object.keys(ids).forEach(pid => {
      const delta = (ni.need[pid] || 0) - (old.qty[pid] || 0);
      if (delta === 0) return;
      const p = getPlant(pid);
      if (p) {
        if (delta > 0 && p.qty < delta) throw stockErr(p.name, p.code, p.qty, delta, 'ต้องเพิ่ม');
        plantNew.push([pid, Object.assign(stockPatch(p, p.qty - delta, now), soldCountPatch(p, delta))]);
      } else if (isGone(pid)) {
        // plant was deleted: nothing to adjust
      } else if (delta > 0) {
        throw stockErr(old.name[pid] || pid, old.code[pid], 0, delta, 'ต้องเพิ่ม');
      } else {
        // sold-out plant that is not loaded: it has qty 0, so the restored amount is simply -delta
        plantNew.push([pid, { qty: -delta, in_stock: true, updated_at: now, sold_at: DELETE }]);
        ensure.push(pid);
      }
    });
    plantNew.forEach(([pid, patch]) => {
      const cur = plants.get(pid);
      if (cur) plants.set(pid, applyPatch(Object.assign({}, cur), patch));
      plantOps.push({ op: 'merge', path: 'plants/' + pid, data: patch });
    });
    const photoOps = [];
    ni.photoSets.forEach(ps => { photoOps.push({ op: 'set', path: 'item_photos/' + ps.id, data: ps.data }); itemPhotoCache.set(ps.id, { data: ps.data.data, crop: ps.data.crop }); });
    ni.photoDeletes.forEach(pid => { photoOps.push({ op: 'delete', path: 'item_photos/' + pid }); itemPhotoCache.set(pid, null); });
    const next = commitOrder(o, { items: ni.items }, plantOps.concat(photoOps));
    ensure.forEach(ensurePlant);
    return next;
  }

  // photo on a custom line: {thumb, full, crop} new/replace · {thumb, crop} re-crop · false remove
  async function setItemPhoto(orderId, index, photo) {
    const o = mustOrder(orderId);
    assertActive(o);
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= o.items.length) throw new Error('ไม่พบรายการสินค้าลำดับที่ ' + (idx + 1));
    const it = o.items[idx];
    if (it.plant_id) throw new Error('ใส่รูปได้เฉพาะรายการที่เพิ่มเอง (ต้นไม้ใช้รูปจากสต็อก)');
    const items = o.items.map(x => Object.assign({}, x));
    const cur = items[idx];
    const ops = [];
    if (photo === false || photo === null || photo === undefined) {
      if (!cur.photo_id) return o;
      ops.push({ op: 'delete', path: 'item_photos/' + cur.photo_id });
      itemPhotoCache.set(cur.photo_id, null);
      delete cur.photo_id; delete cur.thumb;
    } else {
      const ph = checkItemPhoto(photo, true);
      if (ph.recrop) {
        if (!cur.photo_id) throw new Error('ยังไม่มีรูปให้ครอป');
        ops.push({ op: 'merge', path: 'item_photos/' + cur.photo_id, data: { crop: ph.crop } });
        const c = itemPhotoCache.get(cur.photo_id);
        if (c) itemPhotoCache.set(cur.photo_id, { data: c.data, crop: ph.crop });
        cur.thumb = ph.thumb;
      } else {
        const phId = cur.photo_id || adapter.newId();
        ops.push({ op: 'set', path: 'item_photos/' + phId, data: { data: ph.full, crop: ph.crop } });
        itemPhotoCache.set(phId, { data: ph.full, crop: ph.crop });
        cur.photo_id = phId; cur.thumb = ph.thumb;
      }
    }
    return commitOrder(o, { items }, ops);
  }

  function getItemPhotoDoc(photoId) {
    const id = str(photoId);
    if (!id) return Promise.resolve(null);
    if (itemPhotoCache.has(id)) return Promise.resolve(itemPhotoCache.get(id));
    if (itemPhotoInflight.has(id)) return itemPhotoInflight.get(id);
    const pr = adapter.getDoc('item_photos/' + id).then(d => {
      const v = d && d.data ? { data: d.data, crop: d.crop || null } : null;
      if (v) itemPhotoCache.set(id, v);
      return v;
    }).catch(() => null).then(v => { itemPhotoInflight.delete(id); return v; });
    itemPhotoInflight.set(id, pr);
    return pr;
  }

  // ----- pickup places (settings.pickup_places) -----------------------------
  async function savePickupPlace(p) {
    p = p || {};
    const name = str(p.name);
    if (!name) throw new Error('กรุณาระบุชื่อสถานที่นัดรับ');
    const color = str(p.color) || 'grey';
    if (PLACE_COLORS.indexOf(color) < 0) throw new Error('สีไม่ถูกต้อง');
    const list = pickupPlaces();
    const id = str(p.id);
    let place;
    if (id) {
      const i = list.findIndex(x => x.id === id);
      if (i < 0) throw new Error('ไม่พบสถานที่นัดรับ');
      place = { id, name, color };
      list[i] = place;
    } else {
      place = { id: adapter.newId(), name, color };
      list.push(place);
    }
    saveSettings({ pickup_places: list });
    return place;
  }
  async function deletePickupPlace(id) {
    id = str(id);
    const list = pickupPlaces();
    if (!list.some(x => x.id === id)) throw new Error('ไม่พบสถานที่นัดรับ');
    saveSettings({ pickup_places: list.filter(x => x.id !== id) });
    return true;
  }
  async function movePickupPlace(id, dir) {
    id = str(id);
    const list = pickupPlaces();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('ไม่พบสถานที่นัดรับ');
    const j = i + (Number(dir) < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return list;
    const t = list[i]; list[i] = list[j]; list[j] = t;
    saveSettings({ pickup_places: list });
    return list;
  }

  // costs may be edited on any non-cancelled order (shipped / paid included)
  async function updateOrderCosts(id, patch) {
    patch = patch || {};
    const o = mustOrder(id);
    assertActive(o);
    const has = k => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
    const ch = {};
    const upd = [];
    if (patch.items !== undefined && !Array.isArray(patch.items)) throw new Error('ข้อมูลต้นทุนไม่ถูกต้อง');
    (patch.items || []).forEach(x => {
      x = x || {};
      const idx = Number(x.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= o.items.length) throw new Error('ไม่พบรายการสินค้าลำดับที่ ' + (idx + 1));
      upd.push([idx, costVal(x.unit_cost)]);
    });
    if (has('shipping_cost')) ch.shipping_cost = costVal(patch.shipping_cost);
    if (upd.length) {
      const items = o.items.map(it => Object.assign({}, it));
      upd.forEach(([idx, c]) => { items[idx].unit_cost = c; });
      ch.items = items;
    }
    const now = nowIso();
    const plantOps = [];
    const seen = new Set();
    upd.forEach(([idx, c]) => {
      const pid = o.items[idx].plant_id;
      if (!pid || c === null || seen.has(pid)) return;
      const p = getPlant(pid);
      if (!p || (p.cost !== null && p.cost !== undefined)) return;
      seen.add(pid);
      const pp = { cost: c, updated_at: now };
      plants.set(pid, applyPatch(Object.assign({}, plants.get(pid)), pp));
      plantOps.push({ op: 'merge', path: 'plants/' + pid, data: pp });
    });
    return commitOrder(o, ch, plantOps);
  }

  async function recordPayment(id, p) {
    p = p || {};
    const o = mustOrder(id);
    assertActive(o);
    let amt = num(p.amount, null);
    if (amt === null || amt === 0) throw new Error('จำนวนเงินไม่ถูกต้อง');
    amt = round2(amt);
    const date = assertDate(p.date) || today();
    let type = str(p.type).toLowerCase();
    if (PAY_TYPES.indexOf(type) < 0) type = amt < 0 ? 'refund' : 'payment';
    if (amt < 0) type = 'refund';
    if (type === 'refund') amt = -Math.abs(amt);
    const pay = { id: adapter.newId(), date, amount: amt, type, note: str(p.note) };
    return commitOrder(o, { payments: o.payments.concat([pay]) });
  }

  async function deletePayment(id, paymentId) {
    const o = mustOrder(id);
    assertActive(o);
    if (!o.payments.some(p => p.id === paymentId)) throw new Error('ไม่พบรายการชำระเงิน');
    return commitOrder(o, { payments: o.payments.filter(p => p.id !== paymentId) });
  }

  async function markShipped(id, p) {
    p = p || {};
    const o = mustOrder(id);
    assertActive(o);
    const ch = { ship_status: 'shipped', shipped_date: assertDate(p.date) || today() };
    if (str(p.tracking_no)) ch.tracking_no = str(p.tracking_no);
    return commitOrder(o, ch);
  }

  async function unmarkShipped(id) {
    const o = mustOrder(id);
    assertActive(o);
    return commitOrder(o, { ship_status: 'pending', shipped_date: '' });
  }

  async function cancelOrder(id) {
    const o = mustOrder(id);
    if (o.status === 'cancelled') return o;
    const now = nowIso();
    const back = {};
    o.items.forEach(it => { if (it.plant_id) back[it.plant_id] = (back[it.plant_id] || 0) + it.qty; });
    const ops = [];
    const ensure = [];
    Object.keys(back).forEach(pid => {
      const p = getPlant(pid);
      let patch;
      if (p) patch = Object.assign(stockPatch(p, p.qty + back[pid], now), soldCountPatch(p, -back[pid]));
      else if (isGone(pid)) return;
      else { patch = { qty: back[pid], in_stock: true, updated_at: now, sold_at: DELETE }; ensure.push(pid); }
      const cur = plants.get(pid);
      if (cur) plants.set(pid, applyPatch(Object.assign({}, cur), patch));
      ops.push({ op: 'merge', path: 'plants/' + pid, data: patch });
    });
    const next = commitOrder(o, { status: 'cancelled' }, ops);
    ensure.forEach(ensurePlant);
    return next;
  }

  // ----- expenses ----------------------------------------------------------
  async function saveExpense(e) {
    e = e || {};
    const has = k => Object.prototype.hasOwnProperty.call(e, k) && e[k] !== undefined;
    const id = str(e.id);
    const cur = id ? expenses.get(id) : null;
    if (id && !cur) throw new Error('ไม่พบรายการค่าใช้จ่าย');
    const date = assertDate(e.date) || (cur ? cur.date : today());
    const amt = has('amount') ? num(e.amount, NaN) : (cur ? cur.amount : NaN);
    if (!Number.isFinite(amt) || !(amt > 0)) throw new Error('จำนวนเงินต้องมากกว่า 0');
    const category = (has('category') ? str(e.category) : (cur ? cur.category : '')) || 'อื่นๆ';
    const note = has('note') ? str(e.note) : (cur ? str(cur.note) : '');
    const now = nowIso();
    let result;
    if (!cur) {
      result = { id: adapter.newId(), date, ym: ymOf(date), category, amount: round2(amt), note, deleted: false, created_at: now, updated_at: now };
      expenses.set(result.id, result);
      send([{ op: 'set', path: 'expenses/' + result.id, data: result }]);
    } else {
      const patch = { date, ym: ymOf(date), category, amount: round2(amt), note, deleted: false, updated_at: now };
      result = Object.assign({}, cur, patch);
      expenses.set(id, result);
      send([{ op: 'merge', path: 'expenses/' + id, data: patch }]);
    }
    changed(true);
    return result;
  }
  async function deleteExpense(id) {
    const cur = expenses.get(id);
    if (!cur) throw new Error('ไม่พบรายการค่าใช้จ่าย');
    const patch = { deleted: true, updated_at: nowIso() };
    const next = Object.assign({}, cur, patch);
    expenses.set(id, next);
    send([{ op: 'merge', path: 'expenses/' + id, data: patch }]);
    changed(true);
    return next;
  }
  async function loadExpenses(ym) {
    const docs = await adapter.get({ col: 'expenses', where: ['ym', '==', ym] });
    let ch = false;
    docs.forEach(d => { if (upsert('expenses', d)) ch = true; });
    if (ch) changed(false);
    const out = [];
    expenses.forEach(e => { if (e.ym === ym && !e.deleted) out.push(e); });
    return sortExpenses(out);
  }
  function expenseCategories() {
    const out = EXPENSE_CATEGORIES.slice();
    expenses.forEach(e => { const c = str(e.category); if (c && !e.deleted && out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function sumExpenses(ym) {
    let t = 0;
    expenses.forEach(e => { if (!e.deleted && e.ym === ym) t += Number(e.amount) || 0; });
    return round2(t);
  }
  // derived money fields of an order; docs written before v3.5 lack them -> derive on the fly (never persisted)
  function money(o) { return o.profit === undefined || o.cost_total === undefined ? deriveOrder(o) : o; }

  // ----- history / reports (network) ---------------------------------------
  async function fetchOrdersPage() {
    const q = { col: 'orders', orderBy: ['order_date', 'desc'], limit: PAGE };
    if (orderCursor) q.startAfter = orderCursor;
    const docs = await adapter.get(q);
    let ch = false;
    docs.forEach(d => { if (upsert('orders', d)) ch = true; });
    if (docs.length >= PAGE) {
      const oldest = docs[docs.length - 1].order_date;
      orderCursor = oldest;
      // startAfter(value) skips every doc sharing that date: fetch the rest of that day explicitly
      try {
        const same = await adapter.get({ col: 'orders', where: ['order_date', '==', oldest] });
        same.forEach(d => { if (upsert('orders', d)) ch = true; });
      } catch (e) { /* best effort */ }
      state.hasMoreOrders = true;
    } else {
      if (docs.length) orderCursor = docs[docs.length - 1].order_date;
      state.hasMoreOrders = false;
    }
    changed(false);
  }
  function loadMoreOrders() {
    if (!state.hasMoreOrders) return Promise.resolve();
    if (ordersInflight) return ordersInflight;
    ordersInflight = fetchOrdersPage().then(() => { ordersInflight = null; }, e => { ordersInflight = null; throw e; });
    return ordersInflight;
  }

  function canon(docs) {
    let ch = false;
    const out = docs.map(d => { if (upsert('orders', d)) ch = true; return orders.get(d.id) || d; });
    if (ch) changed(false);
    return out;
  }
  function sortOrders(list) {
    return list.slice().sort((a, b) => (a.order_date !== b.order_date ? (a.order_date < b.order_date ? 1 : -1) : codeNum(b.code) - codeNum(a.code)));
  }
  async function loadCustomerOrders(customerId) {
    const docs = await adapter.get({ col: 'orders', where: ['customer_id', '==', customerId] });
    const out = canon(docs);
    // include locally created orders the query may not have returned yet
    const ids = new Set(out.map(o => o.id));
    orders.forEach(o => { if (o.customer_id === customerId && !ids.has(o.id)) out.push(o); });
    return sortOrders(out);
  }
  async function loadMonth(ym) {
    const docs = await adapter.get({ col: 'orders', where: ['ym', '==', ym] });
    const out = canon(docs);
    const ids = new Set(out.map(o => o.id));
    orders.forEach(o => { if (o.ym === ym && !ids.has(o.id)) out.push(o); });
    return sortOrders(out);
  }

  async function computeReport(year) {
    const y = String(year);
    const queries = [adapter.get({ col: 'orders', where: ['ym', '>=', y + '-01', '<=', y + '-12'] })];
    for (let m = 1; m <= 12; m++) queries.push(adapter.get({ col: 'orders', where: ['pay_yms', 'array-contains', y + '-' + pad(m, 2)] }));
    queries.push(adapter.get({ col: 'expenses', where: ['ym', '>=', y + '-01', '<=', y + '-12'] }));
    const results = await Promise.all(queries);
    const expDocs = results.pop();
    expDocs.forEach(d => upsert('expenses', d));
    const all = new Map();
    results.forEach(docs => canon(docs).forEach(o => all.set(o.id, o)));
    orders.forEach(o => { if (o.ym && o.ym.slice(0, 4) === y) all.set(o.id, o); else if ((o.pay_yms || []).some(x => x.slice(0, 4) === y)) all.set(o.id, o); });
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(emptyMonthRow(m, y));
    all.forEach(o => {
      if (o.status !== 'cancelled') {
        (o.payments || []).forEach(p => {
          if (String(p.date).slice(0, 4) === y) { const mi = parseInt(String(p.date).slice(5, 7), 10); if (mi >= 1 && mi <= 12) months[mi - 1].received += p.amount; }
        });
      }
      if (String(o.order_date).slice(0, 4) !== y) return;
      const mi = parseInt(String(o.order_date).slice(5, 7), 10);
      if (!(mi >= 1 && mi <= 12)) return;
      const r = months[mi - 1];
      if (o.status === 'cancelled') { r.cancelled++; return; }
      r.orders++;
      r.plants += (o.items || []).reduce((s, i) => s + i.qty, 0);
      r.sales += o.total;
      r[normChannel(o.channel)] += o.total;
      r.outstanding += o.total - o.paid_amount;
      const m = money(o);
      r.cogs += m.cost_total; r.shipping_cost += m.shipping_cost_eff; r.shipping_fee += m.shipping_fee; r.gross_profit += m.profit; r.cost_missing += m.cost_missing;
    });
    expenses.forEach(e => {
      if (e.deleted || String(e.ym).slice(0, 4) !== y) return;
      const mi = parseInt(String(e.ym).slice(5, 7), 10);
      if (mi >= 1 && mi <= 12) months[mi - 1].expenses += Number(e.amount) || 0;
    });
    const total = {};
    REPORT_KEYS.forEach(k => { total[k] = 0; });
    months.forEach(r => { r.expenses = round2(r.expenses); r.net_profit = round2(r.gross_profit - r.expenses); });
    months.forEach(r => REPORT_KEYS.forEach(k => { r[k] = round2(r[k]); total[k] += r[k]; }));
    REPORT_KEYS.forEach(k => { total[k] = round2(total[k]); });
    return { year: Number(year), months, total };
  }
  function monthlyReport(year, o2) {
    const key = String(year);
    const refresh = !!(o2 && o2.refresh);
    const memo = reportMemo.get(key);
    if (!refresh && memo && memo.ver === localVer) return memo.promise;
    const ver = localVer;
    const promise = computeReport(year);
    reportMemo.set(key, { ver, promise });
    promise.catch(() => { if (reportMemo.get(key) && reportMemo.get(key).promise === promise) reportMemo.delete(key); });
    return promise;
  }

  async function computeDaily(ym) {
    const [monthDocs, payDocs, expRows] = await Promise.all([
      adapter.get({ col: 'orders', where: ['ym', '==', ym] }),
      adapter.get({ col: 'orders', where: ['pay_yms', 'array-contains', ym] }),
      loadExpenses(ym)
    ]);
    const all = new Map();
    canon(monthDocs).concat(canon(payDocs)).forEach(o => all.set(o.id, o));
    orders.forEach(o => { if (o.ym === ym || (o.pay_yms || []).indexOf(ym) >= 0) all.set(o.id, o); });
    const days = new Map();
    const day = date => {
      if (!days.has(date)) { const r = { date }; DAY_KEYS.forEach(k => { r[k] = 0; }); days.set(date, r); }
      return days.get(date);
    };
    all.forEach(o => {
      if (o.status === 'cancelled') return;
      (o.payments || []).forEach(p => { if (ymOf(p.date) === ym) day(p.date).received += p.amount; });
      if (o.ym !== ym) return;
      const r = day(o.order_date);
      const m = money(o);
      r.orders++;
      r.plants += (o.items || []).reduce((s, i) => s + i.qty, 0);
      r.sales += o.total; r.cogs += m.cost_total; r.shipping_cost += m.shipping_cost_eff; r.gross_profit += m.profit; r.cost_missing += m.cost_missing;
    });
    const list = Array.from(days.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    const total = {};
    DAY_KEYS.forEach(k => { total[k] = 0; });
    list.forEach(r => DAY_KEYS.forEach(k => { r[k] = round2(r[k]); total[k] += r[k]; }));
    DAY_KEYS.forEach(k => { total[k] = round2(total[k]); });
    const exp = round2(expRows.reduce((s, e) => s + (Number(e.amount) || 0), 0));
    return { ym, days: list, total, expenses: exp, expense_rows: expRows, net_profit: round2(total.gross_profit - exp) };
  }
  function dailyReport(ym, o2) {
    ym = String(ym || state.today.slice(0, 7));
    const key = 'd:' + ym;
    const refresh = !!(o2 && o2.refresh);
    const memo = reportMemo.get(key);
    if (!refresh && memo && memo.ver === localVer) return memo.promise;
    const ver = localVer;
    const promise = computeDaily(ym);
    reportMemo.set(key, { ver, promise });
    promise.catch(() => { if (reportMemo.get(key) && reportMemo.get(key).promise === promise) reportMemo.delete(key); });
    return promise;
  }

  function monthStats(ym) {
    const t = state.today;
    const s = { orders: 0, sales: 0, received: 0, outstanding_all: 0, outstanding_count: 0, to_ship: 0, ship_today: 0, overdue: 0, gross_profit: 0, cost_missing: 0, expenses: 0, net_profit: 0 };
    orders.forEach(o => {
      if (o.status === 'cancelled') return;
      if (o.ym === ym) { s.orders++; s.sales += o.total; const m = money(o); s.gross_profit += m.profit; s.cost_missing += m.cost_missing; }
      (o.payments || []).forEach(p => { if (ymOf(p.date) === ym) s.received += p.amount; });
      if (o.payment_status !== 'paid') { s.outstanding_all += o.total - o.paid_amount; s.outstanding_count++; }
      if (o.ship_status === 'pending') {
        s.to_ship++;
        if (o.ship_date === t) s.ship_today++;
        else if (o.ship_date && o.ship_date < t) s.overdue++;
      }
    });
    s.gross_profit = round2(s.gross_profit); s.expenses = sumExpenses(ym); s.net_profit = round2(s.gross_profit - s.expenses);
    s.sales = round2(s.sales); s.received = round2(s.received); s.outstanding_all = round2(s.outstanding_all);
    return s;
  }

  async function exportAll() {
    const [pl, cu, or, st, co, ex] = await Promise.all([
      adapter.get({ col: 'plants' }), adapter.get({ col: 'customers' }), adapter.get({ col: 'orders' }),
      adapter.getDoc('settings/main'), adapter.getDoc('meta/counters'), adapter.get({ col: 'expenses' })
    ]);
    return { exported_at: nowIso(), settings: st || {}, counters: co || {}, plants: pl, customers: cu, orders: or, expenses: ex };
  }

  // ----- legacy import (rows in the OLD sheet format) -----------------------
  // opts.existing = result of exportAll(): rows whose code already exists (locally or there) are skipped.
  function importLegacy(data, opts2) {
    data = data || {};
    const existing = (opts2 && opts2.existing) || null;
    const now = nowIso();
    const ops = [];
    const out = { plants: 0, customers: 0, orders: 0, skipped: 0 };
    if (existing && existing.counters) mergeCounters(existing.counters);
    const pc = { plant: counters.plant || 0, customer: counters.customer || 0, order: counters.order || 0, inv: {} };
    const plantByCode = new Map();
    plants.forEach(p => { if (p.code) plantByCode.set(p.code, p.id); });
    const custByCode = new Map();
    customers.forEach(c => { if (c.code) custByCode.set(c.code, c.id); });
    const orderCodes = new Set();
    orders.forEach(o => { if (o.code) orderCodes.add(o.code); });
    if (existing) {
      (existing.plants || []).forEach(p => { if (p && p.code && !plantByCode.has(p.code)) plantByCode.set(p.code, p.id); });
      (existing.customers || []).forEach(c => { if (c && c.code && !custByCode.has(c.code)) custByCode.set(c.code, c.id); });
      (existing.orders || []).forEach(o => { if (o && o.code) orderCodes.add(o.code); });
    }
    const newPlants = new Map();   // code -> doc imported in this run
    const bump = (key, prefix, code) => { if (String(code).indexOf(prefix) === 0) pc[key] = Math.max(pc[key], codeNum(code)); };
    const dstr = v => { const s = str(v); const m = /^(\d{4}-\d{2}-\d{2})/.exec(s); return m ? m[1] : ''; };

    (data.plants || []).forEach(r => {
      const code = str(r.plant_id || r.code);
      if (!code || !str(r.name)) return;
      if (plantByCode.has(code)) { out.skipped++; return; }
      const qty = num(r.qty, 0);
      const created = str(r.created_at) || now, updated = str(r.updated_at) || created;
      const doc = {
        id: adapter.newId(), code, name: str(r.name), detail: str(r.detail), price: round2(num(r.price, 0)), qty, in_stock: qty > 0,
        thumb: '', has_photo: false, note: str(r.note), created_at: created, updated_at: updated
      };
      if (str(r.photo_url)) doc.legacy_photo_url = str(r.photo_url);
      if (qty <= 0) doc.sold_at = updated;
      plants.set(doc.id, doc); plantByCode.set(code, doc.id); newPlants.set(code, doc);
      ops.push({ op: 'set', path: 'plants/' + doc.id, data: doc });
      bump('plant', 'P', code); out.plants++;
    });
    (data.customers || []).forEach(r => {
      const code = str(r.customer_id || r.code);
      if (!code || !str(r.name)) return;
      if (custByCode.has(code)) { out.skipped++; return; }
      const created = str(r.created_at) || now;
      const doc = {
        id: adapter.newId(), code, name: str(r.name), channel: normChannel(r.channel), contact: str(r.contact), country: str(r.country),
        address: str(r.address), note: str(r.note), deleted: false, created_at: created, updated_at: created
      };
      customers.set(doc.id, doc); custByCode.set(code, doc.id);
      ops.push({ op: 'set', path: 'customers/' + doc.id, data: doc });
      bump('customer', 'C', code); out.customers++;
    });
    const itemsBy = {}, paysBy = {};
    (data.order_items || data.orderItems || data.items || []).forEach(r => { (itemsBy[r.order_id] = itemsBy[r.order_id] || []).push(r); });
    (data.payments || []).forEach(r => { if (r && r.order_id) (paysBy[r.order_id] = paysBy[r.order_id] || []).push(r); });
    (data.orders || []).forEach(r => {
      const code = str(r.order_id || r.code);
      if (!code) return;
      if (orderCodes.has(code)) { out.skipped++; return; }
      const od = dstr(r.order_date) || today();
      const rawItems = Array.isArray(r.items) ? r.items : (itemsBy[code] || []);
      const items = rawItems.map(it => {
        const lc = str(it.plant_id);
        const pid = lc ? (plantByCode.get(lc) || '') : '';
        return { plant_id: pid, code: lc, name: str(it.name) || lc || 'item', unit_price: round2(num(it.unit_price, 0)), qty: num(it.qty, 1) };
      });
      const rawPays = Array.isArray(r.payments) ? r.payments : (paysBy[code] || []);
      let payments = rawPays.map(p => ({
        id: adapter.newId(), date: dstr(p.date) || od, amount: round2(num(p.amount, 0)), type: PAY_TYPES.indexOf(str(p.type)) >= 0 ? str(p.type) : (num(p.amount, 0) < 0 ? 'refund' : 'payment'), note: str(p.note)
      }));
      if (!payments.length && num(r.paid_amount, 0) > 0) {
        payments = [{ id: adapter.newId(), date: dstr(r.paid_date) || od, amount: round2(num(r.paid_amount, 0)), type: 'payment', note: 'migrated' }];
      }
      const cid = str(r.customer_id) ? (custByCode.get(str(r.customer_id)) || '') : '';
      const created = str(r.created_at) || now;
      const order = deriveOrder({
        id: adapter.newId(), code, invoice_no: str(r.invoice_no), order_date: od, customer_id: cid, customer_name: str(r.customer_name),
        channel: normChannel(r.channel), items, shipping_fee: num(r.shipping_fee, 0), discount: num(r.discount, 0), payments,
        ship_date: dstr(r.ship_date), ship_status: str(r.ship_status) === 'shipped' ? 'shipped' : 'pending', shipped_date: dstr(r.shipped_date),
        tracking_no: str(r.tracking_no), status: str(r.status) === 'cancelled' ? 'cancelled' : 'active', note: str(r.note),
        created_at: created, updated_at: str(r.updated_at) || created
      });
      orders.set(order.id, order); orderCodes.add(code);
      if (order.status !== 'cancelled') order.items.forEach(it => { const nd = it.code && newPlants.get(it.code); if (nd) nd.sold_count = (nd.sold_count || 0) + it.qty; });
      ops.push({ op: 'set', path: 'orders/' + order.id, data: order });
      bump('order', 'O', code); out.orders++;
      const m = /-(\d{6})-(\d+)$/.exec(order.invoice_no);
      if (m) pc.inv[m[1]] = Math.max(pc.inv[m[1]] || 0, parseInt(m[2], 10));
    });
    const s = {};
    if (data.settings && typeof data.settings === 'object') {
      // old settings only fill fields still at their default / empty value
      LEGACY_SETTING_KEYS.forEach(k => {
        const v = data.settings[k];
        if (v === undefined || v === null || v === '') return;
        const curV = state.settings[k];
        if (curV === '' || curV === undefined || curV === DEFAULT_SETTINGS[k]) s[k] = String(v);
      });
    }
    s.legacy_imported = true;
    settingsDoc = Object.assign({}, settingsDoc || {}, s); recomputeSettings();
    ops.push({ op: 'merge', path: 'settings/main', data: s });
    const cp = {};
    ['plant', 'customer', 'order'].forEach(k => { if (pc[k] > (counters[k] || 0)) cp[k] = pc[k]; });
    const inv = {};
    Object.keys(pc.inv).forEach(k => { if (pc.inv[k] > ((counters.inv && counters.inv[k]) || 0)) inv[k] = pc.inv[k]; });
    if (Object.keys(inv).length) cp.inv = inv;
    mergeCounters(cp);
    ops.push.apply(ops, counterOps(cp));
    send(ops);
    changed(true);
    return out;
  }

  // ----- restore from a backup file (exportAll() format) ---------------------
  // opts.existing = result of exportAll(); opts.overwrite = write every doc from the backup.
  const SETTING_KEEP_IF_EMPTY = ['bridge_url', 'bridge_token', 'push_vapid_key', 'gemini_api_key'];
  function restoreBackup(data, opts2) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.plants) || !Array.isArray(data.customers) || !Array.isArray(data.orders)) {
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
    }
    opts2 = opts2 || {};
    const overwrite = opts2.overwrite === true;
    const ex = opts2.existing || {};
    const ids = list => { const set = new Set(); (list || []).forEach(d => { if (d && d.id) set.add(d.id); }); return set; };
    const exPlants = ids(ex.plants), exCust = ids(ex.customers), exOrders = ids(ex.orders), exExp = ids(ex.expenses);
    // anything already in memory is also "present"
    plants.forEach((_, id) => exPlants.add(id)); customers.forEach((_, id) => exCust.add(id)); orders.forEach((_, id) => exOrders.add(id)); expenses.forEach((_, id) => exExp.add(id));
    const ops = [];
    const out = { plants: 0, customers: 0, orders: 0, expenses: 0, skipped: 0, settings: false };
    const pick = (list, present, fn) => {
      (list || []).forEach(d => {
        if (!d || typeof d !== 'object' || !str(d.id)) return;
        if (!overwrite && present.has(d.id)) { out.skipped++; return; }
        fn(d);
      });
    };
    pick(data.plants, exPlants, d => {
      const doc = Object.assign({}, d);
      const qty = num(doc.qty, 0);
      doc.qty = qty;
      doc.in_stock = qty > 0;
      if (qty > 0) delete doc.sold_at; else if (!doc.sold_at) doc.sold_at = str(doc.updated_at) || nowIso();
      doc.has_photo = !!doc.has_photo && exPlants.has(d.id);
      plants.set(doc.id, doc);
      ops.push({ op: 'set', path: 'plants/' + doc.id, data: doc });
      out.plants++;
    });
    pick(data.customers, exCust, d => {
      const doc = Object.assign({}, d);
      customers.set(doc.id, doc);
      ops.push({ op: 'set', path: 'customers/' + doc.id, data: doc });
      out.customers++;
    });
    pick(data.orders, exOrders, d => {
      const doc = deriveOrder(Object.assign({}, d));
      orders.set(doc.id, doc);
      ops.push({ op: 'set', path: 'orders/' + doc.id, data: doc });
      out.orders++;
    });
    pick(Array.isArray(data.expenses) ? data.expenses : [], exExp, d => {
      const doc = Object.assign({}, d);
      expenses.set(doc.id, doc);
      ops.push({ op: 'set', path: 'expenses/' + doc.id, data: doc });
      out.expenses++;
    });
    if (overwrite && data.settings && typeof data.settings === 'object') {
      const sp = {};
      Object.keys(data.settings).forEach(k => {
        if (k === 'id') return;
        const v = data.settings[k];
        if (v === undefined || v === null) return;
        if (SETTING_KEEP_IF_EMPTY.indexOf(k) >= 0 && v === '') return;
        sp[k] = v;
      });
      if (Object.keys(sp).length) {
        settingsDoc = Object.assign({}, settingsDoc || {}, sp); recomputeSettings();
        ops.push({ op: 'merge', path: 'settings/main', data: sp });
        out.settings = true;
      }
    }
    // counters: max(current, backup)
    const cs = data.counters && typeof data.counters === 'object' ? data.counters : {};
    const cur = {}; Object.assign(cur, ex.counters || {});
    const cp = {};
    ['plant', 'customer', 'order'].forEach(k => {
      const have = Math.max(counters[k] || 0, (cur[k] | 0));
      if (typeof cs[k] === 'number' && cs[k] > have) cp[k] = cs[k];
    });
    if (cs.inv && typeof cs.inv === 'object') {
      const inv = {};
      Object.keys(cs.inv).forEach(k => {
        const have = Math.max((counters.inv && counters.inv[k]) || 0, (cur.inv && cur.inv[k]) || 0);
        if (typeof cs.inv[k] === 'number' && cs.inv[k] > have) inv[k] = cs.inv[k];
      });
      if (Object.keys(inv).length) cp.inv = inv;
    }
    mergeCounters(cp);
    ops.push.apply(ops, counterOps(cp));
    send(ops);
    changed(true);
    return out;
  }

  // ----- listeners / lifecycle ---------------------------------------------
  function updatePending() {
    const p = Object.keys(pendingFlags).some(k => pendingFlags[k]);
    if (p !== state.pending) { state.pending = p; changed(false); }
  }
  function readSync() { try { return (globalThis.localStorage && globalThis.localStorage.getItem(LS_SYNC)) || ''; } catch (e) { return ''; } }
  function writeSync(v) { try { if (globalThis.localStorage) globalThis.localStorage.setItem(LS_SYNC, v); } catch (e) { /* ignore */ } }

  function listen(key, col, q, matches, onFirst, extra) {
    return adapter.watch(q, snap => {
      pendingFlags[key] = !!snap.pending;
      let ch = false;
      (snap.docs || []).forEach(d => { if (upsert(col, d)) ch = true; });
      (snap.removed || []).forEach(id => {
        const map = mapOf(col);
        const local = map.get(id);
        if (local && !matches(local)) return; // our own change explains the removal
        adapter.getDoc(col + '/' + id).then(d => {
          if (d) { if (upsert(col, d)) changed(false); }
          else if (map.delete(id)) changed(false);
        }).catch(() => {});
      });
      if (extra) extra(snap);
      if (ch) changed(false);
      updatePending();
      if (onFirst) { const f = onFirst; onFirst = null; f(); }
    });
  }
  function attachMonth() {
    currentYm = state.today.slice(0, 7);
    const ym = currentYm;
    monthUnsubs.push(listen('month', 'orders', { col: 'orders', where: ['ym', '==', ym] }, o => o.ym === ym));
    monthUnsubs.push(listen('expMonth', 'expenses', { col: 'expenses', where: ['ym', '==', ym] }, e => e.ym === ym));
    monthUnsubs.push(listen('payMonth', 'orders', { col: 'orders', where: ['pay_yms', 'array-contains', ym] }, o => (o.pay_yms || []).indexOf(ym) >= 0));
  }
  function detachMonth() {
    monthUnsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    monthUnsubs = [];
    delete pendingFlags.month; delete pendingFlags.payMonth; delete pendingFlags.expMonth;
  }
  function checkRollover() {
    const t = today();
    if (t === state.today) return;
    state.today = t;
    if (started && t.slice(0, 7) !== currentYm) { detachMonth(); attachMonth(); }
    reportMemo.clear();
    changed(false);
  }

  async function loadCustomers() {
    let docs = [];
    try { docs = await adapter.get({ col: 'customers', source: 'cache' }); } catch (e) { docs = []; }
    let full = false;
    if (!docs.length) { try { docs = await adapter.get({ col: 'customers' }); full = true; } catch (e) { docs = []; } }
    docs.forEach(d => upsert('customers', d));
    let max = '';
    docs.forEach(d => { if (d.updated_at) max = maxStr(max, d.updated_at); });
    const stored = readSync();
    lastSync = full ? max : (stored || max);
    writeSync(lastSync);
    changed(false);
    unsubs.push(adapter.watch({ col: 'customers', where: ['updated_at', '>', lastSync] }, snap => {
      let ch = false, mx = lastSync;
      (snap.docs || []).forEach(d => { if (upsert('customers', d)) ch = true; if (d.updated_at) mx = maxStr(mx, d.updated_at); });
      if (mx !== lastSync) { lastSync = mx; writeSync(lastSync); }
      pendingFlags.customers = !!snap.pending;
      if (ch) changed(false);
      updatePending();
    }));
  }

  function start() {
    if (startPromise) return startPromise;
    started = true;
    state.online = adapter.isOnline();
    state.today = today();
    if (!errHooked) { errHooked = true; adapter.onError(e => { errHandlers.forEach(h => { try { h(e); } catch (x) { /* ignore */ } }); }); }
    unsubs.push(adapter.onOnline(b => { state.online = !!b; changed(false); }));
    const gates = [];
    const gate = () => { let r; gates.push(new Promise(res => { r = res; })); return r; };
    const gSettings = gate(), gCounters = gate(), gPlants = gate(), gOpen = gate();
    unsubs.push(adapter.watchDoc('settings/main', d => { settingsDoc = d; recomputeSettings(); changed(false); gSettings(); }));
    unsubs.push(adapter.watchDoc('meta/counters', d => { mergeCounters(d); gCounters(); }));
    unsubs.push(listen('plants', 'plants', { col: 'plants', where: ['in_stock', '==', true] }, p => p.in_stock === true, gPlants));
    unsubs.push(listen('open', 'orders', { col: 'orders', where: ['open', '==', true] }, o => o.open === true, gOpen));
    attachMonth();
    const gCust = loadCustomers().catch(() => {});
    gates.push(gCust);
    // recent history in the background
    fetchOrdersPage().catch(() => {});
    const timeout = new Promise(res => setTimeout(res, opts.readyTimeout || 6000));
    startPromise = Promise.race([Promise.all(gates), timeout]).then(() => {
      state.ready = true;
      changed(false);
      if (typeof setInterval === 'function') { timer = setInterval(checkRollover, 30000); if (timer && timer.unref) timer.unref(); }
    });
    return startPromise;
  }

  function stop() {
    unsubs.splice(0).forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    detachMonth();
    if (timer) { clearInterval(timer); timer = null; }
    started = false; startPromise = null; state.ready = false;
  }

  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
  function onError(fn) { errHandlers.add(fn); return () => errHandlers.delete(fn); }

  return {
    start, stop, subscribe, state, onError, checkRollover,
    onLocalChange, getPlant, getCustomer, getOrder, getExpense: id => expenses.get(id) || null, balance,
    saveSettings, savePlant, deletePlant, getPlantPhoto, getPlantPhotoDoc, purgeOldPhotos, loadSoldPlants, saveCustomer, deleteCustomer,
    createOrder, createOrdersBatch, updateOrder, updateOrderItems, setItemPhoto, getItemPhotoDoc, pickupPlaces, savePickupPlace, deletePickupPlace, movePickupPlace, recordPayment, deletePayment,
    markShipped, unmarkShipped, cancelOrder,
    updateOrderCosts, saveExpense, deleteExpense, loadExpenses, expenseCategories,
    loadMoreOrders, loadCustomerOrders, loadMonth, monthlyReport, dailyReport, monthStats, exportAll, importLegacy, restoreBackup
  };
}
