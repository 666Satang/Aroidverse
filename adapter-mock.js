// adapter-mock.js — in-memory adapter (demo mode `?demo=1` + tests). Same interface as adapter-fire.js.
// Options: {seed:true} sample data · {latency:ms} delays get/getDoc only · {noCache:true} source:'cache' returns [] ·
//          {user:{uid,email}} · {password:'x'} (require this password for signIn; default accepts anything)
// Test helpers (prefixed _): _commits, _data, _external(ops), _setOnline(b), _setPending(b), _signedIn.
import { todayStr, deriveOrder } from './store.js';

const DELETE = Symbol('adapter.DELETE');

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  Object.keys(v).forEach(k => { o[k] = clone(v[k]); });
  return o;
}
function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function mergeInto(target, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v === DELETE) delete target[k];
    else if (isPlain(v) && isPlain(target[k])) mergeInto(target[k], v);
    else if (isPlain(v)) { target[k] = {}; mergeInto(target[k], v); }
    else target[k] = clone(v);
  });
  return target;
}
function stripDeletes(data) {
  const o = {};
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v === DELETE) return;
    o[k] = isPlain(v) ? stripDeletes(v) : clone(v);
  });
  return o;
}
function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

function evalWhere(doc, where) {
  if (!where) return true;
  const v = doc[where[0]];
  if (v === undefined || v === null) return false;
  for (let i = 1; i + 1 < where.length; i += 2) {
    const op = where[i], val = where[i + 1];
    let ok;
    switch (op) {
      case '==': ok = v === val; break;
      case '>': ok = v > val; break;
      case '>=': ok = v >= val; break;
      case '<': ok = v < val; break;
      case '<=': ok = v <= val; break;
      case 'array-contains': ok = Array.isArray(v) && v.indexOf(val) >= 0; break;
      default: throw new Error('mock: unsupported operator ' + op);
    }
    if (!ok) return false;
  }
  return true;
}

export default function createAdapter(options) {
  options = options || {};
  const cols = new Map();       // col -> Map(id -> {data, rev})
  let revCounter = 0;
  const commits = [];
  const watchers = new Set();   // {kind:'q'|'doc', q|path, cb, sig, ids}
  let online = true;
  let pendingFlag = false;
  let user = options.user || { uid: 'demo-user', email: 'demo@example.com' };
  const authCbs = new Set();
  const onlineCbs = new Set();
  const errCbs = new Set();
  let flushQueued = false;

  function col(name) { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); }
  function splitPath(path) { const i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; }
  function putRaw(c, id, data) { col(c).set(id, { data, rev: ++revCounter }); }
  function view(c, id) { const e = col(c).get(id); return e ? Object.assign(clone(e.data), { id }) : null; }

  function runQuery(q) {
    if (q.where && q.orderBy && q.where[0] !== q.orderBy[0]) {
      throw new Error('mock: where + orderBy on different fields needs a composite index (' + q.where[0] + ' / ' + q.orderBy[0] + ')');
    }
    let rows = [];
    col(q.col).forEach((e, id) => { if (evalWhere(e.data, q.where || null)) rows.push({ id, data: e.data, rev: e.rev }); });
    if (q.orderBy) {
      const f = q.orderBy[0], dir = q.orderBy[1] === 'desc' ? -1 : 1;
      rows = rows.filter(r => r.data[f] !== undefined && r.data[f] !== null);
      rows.sort((a, b) => (cmp(a.data[f], b.data[f]) || cmp(a.id, b.id)) * dir);
      if (q.startAfter !== undefined && q.startAfter !== null) rows = rows.filter(r => (dir === 1 ? r.data[f] > q.startAfter : r.data[f] < q.startAfter));
    } else {
      rows.sort((a, b) => cmp(a.id, b.id));
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows;
  }
  const rowsToDocs = rows => rows.map(r => Object.assign(clone(r.data), { id: r.id }));

  function scheduleFlush() {
    if (flushQueued) return;
    flushQueued = true;
    Promise.resolve().then(() => { flushQueued = false; watchers.forEach(w => fire(w, false)); });
  }
  function fire(w, force) {
    if (w.dead) return;
    if (w.kind === 'doc') {
      const [c, id] = splitPath(w.path);
      const e = col(c).get(id);
      const sig = e ? String(e.rev) : 'null';
      if (!force && sig === w.sig) return;
      w.sig = sig;
      w.cb(view(c, id));
      return;
    }
    const rows = runQuery(w.q);
    const sig = rows.map(r => r.id + ':' + r.rev).join(',') + '|' + pendingFlag;
    if (!force && sig === w.sig) return;
    w.sig = sig;
    const ids = new Set(rows.map(r => r.id));
    const removed = [];
    w.ids.forEach(id => { if (!ids.has(id)) removed.push(id); });
    w.ids = ids;
    w.cb({ docs: rowsToDocs(rows), removed, pending: pendingFlag, fromCache: false });
  }

  function applyOps(ops) {
    const touched = new Set();
    ops.forEach(op => {
      const [c, id] = splitPath(op.path);
      touched.add(c);
      if (op.op === 'set') putRaw(c, id, stripDeletes(op.data || {}));
      else if (op.op === 'merge') {
        const e = col(c).get(id);
        const data = e ? clone(e.data) : {};
        mergeInto(data, op.data || {});
        putRaw(c, id, data);
      } else if (op.op === 'delete') col(c).delete(id);
      else throw new Error('mock: unknown op ' + op.op);
    });
    scheduleFlush();
  }

  function delayed(fn) {
    if (!options.latency) return Promise.resolve().then(fn);
    return new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, options.latency));
  }

  const adapter = {
    DELETE,
    init() { return Promise.resolve(); },
    onAuth(cb) {
      authCbs.add(cb);
      Promise.resolve().then(() => { if (authCbs.has(cb)) cb(user ? { uid: user.uid, email: user.email } : null); });
      return () => authCbs.delete(cb);
    },
    signIn(email, password) {
      if (!String(email || '').trim() || !password) return Promise.reject(new Error('กรุณากรอกอีเมลและรหัสผ่าน'));
      if (options.password && password !== options.password) return Promise.reject(new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
      user = { uid: 'demo-user', email: String(email).trim() };
      authCbs.forEach(cb => cb({ uid: user.uid, email: user.email }));
      return Promise.resolve();
    },
    signOut() { user = null; authCbs.forEach(cb => cb(null)); return Promise.resolve(); },
    newId() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let s = '';
      const g = globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(20)) : null;
      for (let i = 0; i < 20; i++) s += chars[(g ? g[i] : Math.floor(Math.random() * 256)) % chars.length];
      return s;
    },
    watchDoc(path, cb) {
      const w = { kind: 'doc', path, cb, sig: null, dead: false };
      watchers.add(w);
      Promise.resolve().then(() => fire(w, w.sig === null));
      return () => { w.dead = true; watchers.delete(w); };
    },
    watch(q, cb) {
      const w = { kind: 'q', q: clone(q), cb, sig: null, ids: new Set(), dead: false };
      watchers.add(w);
      Promise.resolve().then(() => fire(w, w.sig === null));
      return () => { w.dead = true; watchers.delete(w); };
    },
    get(q) {
      if (q.source === 'cache' && options.noCache) return Promise.resolve([]);
      return delayed(() => rowsToDocs(runQuery(q)));
    },
    getDoc(path) {
      const [c, id] = splitPath(path);
      return delayed(() => view(c, id));
    },
    commit(ops) {
      commits.push(ops.map(o => ({ op: o.op, path: o.path, data: o.data === undefined ? undefined : clone(o.data) })));
      try { applyOps(ops); } catch (e) { Promise.resolve().then(() => errCbs.forEach(cb => cb(e))); }
    },
    onError(cb) { errCbs.add(cb); },
    isOnline() { return online; },
    onOnline(cb) { onlineCbs.add(cb); return () => onlineCbs.delete(cb); },

    // ---- test helpers ----
    _commits: commits,
    _col(name) { return Array.from(col(name).entries()).map(([id, e]) => Object.assign(clone(e.data), { id })); },
    _doc(path) { const [c, id] = splitPath(path); return view(c, id); },
    _external(ops) { applyOps(ops); },   // simulate a change made by another device (not recorded in _commits)
    _setOnline(b) { online = !!b; onlineCbs.forEach(cb => cb(online)); },
    _setPending(b) { pendingFlag = !!b; watchers.forEach(w => fire(w, w.kind === 'q')); },
    _reset() { cols.clear(); commits.length = 0; }
  };

  if (options.seed) seed(adapter, putRaw);
  return adapter;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
function addDays(ds, n) {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function svgThumb(bg, fg, size) {
  const s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="' + size + '" height="' + size + '">' +
    '<rect width="96" height="96" fill="' + bg + '"/><path d="M48 76V44M48 54c-10 0-18-8-18-20 12 0 18 8 18 20zm0-6c0-10 7-17 18-17 0 11-7 17-18 17z" fill="none" stroke="' + fg + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

function seed(adapter, putRaw) {
  const today = todayStr();
  const ym = today.slice(0, 7);
  const firstOfMonth = ym + '-01';
  const lastMonthDay = addDays(firstOfMonth, -12);          // always in the previous month
  const now = new Date().toISOString();
  const iso = (ds, h) => ds + 'T' + (h || '10:00:00') + '.000Z';
  const palette = [['#E8F3EC', '#5E9B7B'], ['#FCE9DF', '#E39A74'], ['#EDE8F7', '#8F7BC4'], ['#E6F0F8', '#6B9CC4']];

  const P = [
    ['P0001', 'Monstera Albo Variegata', 'ใบด่างขาวสวย รากแน่น กระถาง 6 นิ้ว', 4500, 1],
    ['P0002', 'Philodendron Pink Princess', 'ด่างชมพูเข้ม ต้นสูง 30 ซม.', 1800, 2],
    ['P0003', 'Alocasia Frydek Variegated', 'ด่างเขียวขาว ใบใหญ่', 950, 1],
    ['P0004', 'Hoya Kerrii Variegated', 'ใบหัวใจด่างครีม', 650, 5],
    ['P0005', 'Thai Constellation', 'ด่างกระจายแบบดาว ต้นใหญ่', 7800, 1],
    ['P0006', 'Syngonium Albo', 'ด่างขาว โตไว', 350, 3],
    ['P0007', 'Anthurium Warocqueanum', 'ใบกำมะหยี่ยาว 60 ซม.', 6500, 1],
    ['P0008', 'Philodendron Spiritus Sancti', 'ตัวหายากมาก ขายแล้ว', 25000, 0]
  ];
  const plantId = {};
  P.forEach((r, i) => {
    const id = adapter.newId();
    plantId[r[0]] = id;
    const hasPhoto = i % 2 === 0;
    const pal = palette[i % palette.length];
    const doc = {
      code: r[0], name: r[1], detail: r[2], price: r[3], qty: r[4], in_stock: r[4] > 0,
      thumb: svgThumb(pal[0], pal[1], 96), has_photo: hasPhoto, note: '',
      created_at: iso(addDays(today, -40 + i)), updated_at: iso(addDays(today, -40 + i))
    };
    if (r[4] === 0) { doc.sold_at = iso(lastMonthDay); doc.updated_at = doc.sold_at; }
    putRaw('plants', id, doc);
    if (hasPhoto) putRaw('plant_photos', id, { data: svgThumb(pal[0], pal[1], 640) });
  });

  const C = [
    ['C0001', 'Hans Becker', 'facebook', 'facebook.com/hans.becker', 'Germany', 'Hauptstr. 12\n10115 Berlin\nGermany'],
    ['C0002', 'Emma Wilson', 'instagram', '@emma.plants', 'United Kingdom', '14 Rose Lane\nBristol BS1 4DJ\nUnited Kingdom'],
    ['C0003', 'คุณมะลิ', 'walkin', '081-234-5678', 'Thailand', ''],
    ['C0004', 'Yuki Tanaka', 'other', 'LINE: yuki_t', 'Japan', '2-3-4 Shibuya\nTokyo 150-0002\nJapan']
  ];
  const custId = {};
  C.forEach((r, i) => {
    const id = adapter.newId();
    custId[r[0]] = id;
    putRaw('customers', id, { code: r[0], name: r[1], channel: r[2], contact: r[3], country: r[4], address: r[5], note: '', deleted: false, created_at: iso(addDays(today, -60 + i)), updated_at: iso(addDays(today, -60 + i)) });
  });

  const item = (code, name, price, qty) => ({ plant_id: code ? plantId[code] : '', code: code || '', name, unit_price: price, qty });
  const pay = (date, amount, type, note) => ({ id: adapter.newId(), date, amount, type, note: note || '' });
  const invCount = {};
  const mkOrder = (n, o) => {
    const ym6 = o.order_date.slice(0, 4) + o.order_date.slice(5, 7);
    invCount[ym6] = (invCount[ym6] || 0) + 1;
    const c = custId[o.cust];
    const cust = C.find(x => x[0] === o.cust);
    const doc = deriveOrder(Object.assign({
      id: adapter.newId(), code: 'O' + String(n).padStart(5, '0'), invoice_no: 'INV-' + ym6 + '-' + String(invCount[ym6]).padStart(3, '0'),
      customer_id: c, customer_name: cust[1], channel: cust[2], shipping_fee: 0, discount: 0, payments: [], ship_date: '',
      ship_status: 'pending', shipped_date: '', tracking_no: '', status: 'active', note: '',
      created_at: iso(o.order_date), updated_at: iso(o.order_date, '11:00:00')
    }, o));
    delete doc.cust;
    const id = doc.id;
    putRaw('orders', id, doc);
  };
  // 1. unpaid, ships tomorrow
  mkOrder(1, { cust: 'C0001', order_date: addDays(today, -1), ship_date: addDays(today, 1), items: [item('P0002', 'Philodendron Pink Princess', 1800, 1), item('', 'Sphagnum moss pack', 120, 2)], shipping_fee: 450, note: 'ขอรากสะอาดๆ' });
  // 2. deposit only, ships in 3 days
  mkOrder(2, { cust: 'C0002', order_date: addDays(today, -2), ship_date: addDays(today, 3), items: [item('P0004', 'Hoya Kerrii Variegated', 650, 2), item('P0006', 'Syngonium Albo', 350, 1)], shipping_fee: 380, payments: [pay(addDays(today, -2), 1000, 'deposit', 'โอนมัดจำ')] });
  // 3. fully paid but shipment overdue
  mkOrder(3, { cust: 'C0004', order_date: addDays(today, -6), ship_date: addDays(today, -3), items: [item('P0003', 'Alocasia Frydek Variegated', 950, 1)], shipping_fee: 500, discount: 50, payments: [pay(addDays(today, -6), 1400, 'payment')] });
  // 4. walk-in, paid + handed over today
  mkOrder(4, { cust: 'C0003', order_date: today, items: [item('P0006', 'Syngonium Albo', 350, 1), item('P0004', 'Hoya Kerrii Variegated', 650, 1)], ship_status: 'shipped', shipped_date: today, payments: [pay(today, 1000, 'payment')] });
  // 5. cancelled
  mkOrder(5, { cust: 'C0001', order_date: addDays(today, -4), items: [item('P0001', 'Monstera Albo Variegata', 4500, 1)], status: 'cancelled', payments: [pay(addDays(today, -4), 2000, 'deposit')], note: 'ลูกค้ายกเลิก' });
  // 6. last month, paid + shipped (the sold-out plant)
  mkOrder(6, { cust: 'C0002', order_date: lastMonthDay, items: [item('P0008', 'Philodendron Spiritus Sancti', 25000, 1)], shipping_fee: 800, ship_status: 'shipped', shipped_date: addDays(lastMonthDay, 2), tracking_no: 'EE123456789TH', ship_date: addDays(lastMonthDay, 2), payments: [pay(lastMonthDay, 12900, 'deposit'), pay(addDays(lastMonthDay, 1), 12900, 'payment')] });

  const inv = {};
  Object.keys(invCount).forEach(k => { inv[k] = invCount[k]; });
  putRaw('meta', 'counters', { plant: 8, customer: 4, order: 6, inv });
  putRaw('settings', 'main', { shop_name: 'Leaf & Co. (ตัวอย่าง)', bank_name: 'Kasikorn Bank (KBank)', bank_account_no: '123-4-56789-0', bank_account_name: 'Demo Seller', contact_email: 'shop@example.com', currency: 'THB', invoice_prefix: 'INV', invoice_note: 'Thank you for your order!', gemini_api_key: '', gemini_model: 'gemini-flash-latest' });
  void now;
}
