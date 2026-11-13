// bridge.js — background mirror of the store to the owner's Google Sheet / Calendar via an Apps Script web app (SPEC4 §1).
// Plain ES module, no dependencies. The app NEVER waits for this: store.onLocalChange feeds a persisted queue of dirty ids,
// flushed in the background (debounced), and nothing here throws into the UI except the explicit calls
// (pushAll / test / fetchLegacy), which reject with a Thai Error.

const LS_QUEUE = 'plantapp_bridge_queue';
const DEBOUNCE_MS = 5000;
const PERIODIC_MS = 5 * 60 * 1000;
const BACKOFF_MIN = 30 * 1000;
const BACKOFF_MAX = 5 * 60 * 1000;
export const CHUNK = { orders: 40, plants: 100, customers: 100 };
const KEYS = ['orders', 'plants', 'customers', 'dplants', 'dcustomers'];

function lsGet(k) { try { return (globalThis.localStorage && globalThis.localStorage.getItem(k)) || null; } catch (e) { return null; } }
function lsSet(k, v) { try { if (globalThis.localStorage) globalThis.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

function stripThumb(p) { const o = Object.assign({}, p); delete o.thumb; return o; }

// opts (all optional, for tests): { debounceMs, periodicMs, backoffMin, backoffMax }
export function createBridge(store, opts) {
  opts = opts || {};
  const debounceMs = opts.debounceMs !== undefined ? opts.debounceMs : DEBOUNCE_MS;
  const periodicMs = opts.periodicMs !== undefined ? opts.periodicMs : PERIODIC_MS;
  const backoffMin = opts.backoffMin !== undefined ? opts.backoffMin : BACKOFF_MIN;
  const backoffMax = opts.backoffMax !== undefined ? opts.backoffMax : BACKOFF_MAX;

  // queue: per key a Map(id -> seq). A later local change bumps seq, so an in-flight success can tell "re-dirtied meanwhile".
  const q = {};
  KEYS.forEach(k => { q[k] = new Map(); });
  let seq = 0;

  let started = false;
  let busy = false;
  let inflight = null;
  let pushing = false;
  let lastOk = null;
  let lastError = null;
  let failures = 0;
  let backoffUntil = 0;
  let timer = null;
  let timerAt = 0;
  let periodic = null;
  let unsubLocal = null;
  let unsubStore = null;
  let onlineHandler = null;
  let lastOnline = true;
  let lastSig = '';
  const statusCbs = new Set();

  // ----- queue ---------------------------------------------------------------
  function loadQueue() {
    const raw = lsGet(LS_QUEUE);
    if (!raw) return;
    try {
      const o = JSON.parse(raw);
      KEYS.forEach(k => { (Array.isArray(o && o[k]) ? o[k] : []).forEach(id => { if (typeof id === 'string' && id && !q[k].has(id)) q[k].set(id, 0); }); });
    } catch (e) { /* corrupt: ignore */ }
  }
  function saveQueue() {
    const o = {};
    KEYS.forEach(k => { o[k] = Array.from(q[k].keys()); });
    lsSet(LS_QUEUE, JSON.stringify(o));
  }
  function pendingCount() { let n = 0; KEYS.forEach(k => { n += q[k].size; }); return n; }
  function mark(key, id) { q[key].set(id, ++seq); }
  function onLocal(ev) {
    try {
      ev = ev || {};
      (ev.orders || []).forEach(id => mark('orders', id));
      (ev.plants || []).forEach(id => { q.dplants.delete(id); mark('plants', id); });
      (ev.customers || []).forEach(id => { q.dcustomers.delete(id); mark('customers', id); });
      const d = ev.deleted || {};
      (d.plants || []).forEach(id => { q.plants.delete(id); mark('dplants', id); });
      (d.customers || []).forEach(id => { q.customers.delete(id); mark('dcustomers', id); });
      saveQueue();
      schedule(debounceMs);
      emit();
    } catch (e) { /* never throw into the store */ }
  }
  // remove the sent ids unless they were re-dirtied after the snapshot
  function ack(sent) {
    KEYS.forEach(k => { (sent[k] || []).forEach(([id, s]) => { if (q[k].get(id) === s) q[k].delete(id); }); });
    saveQueue();
  }

  // ----- config / status -------------------------------------------------------
  function cfg() {
    const s = (store && store.state && store.state.settings) || {};
    return { url: String(s.bridge_url || '').trim(), token: String(s.bridge_token || '').trim() };
  }
  function configured() { const c = cfg(); return /^https?:\/\//i.test(c.url) && !!c.token; }
  function online() {
    if (store && store.state && store.state.online === false) return false;
    try { if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false; } catch (e) { /* ignore */ }
    return true;
  }
  function status() { return { configured: configured(), pending: pendingCount(), busy, lastOk, lastError }; }
  function emit() {
    const s = status();
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    statusCbs.forEach(fn => { try { fn(s); } catch (e) { /* ignore */ } });
  }
  function onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); }

  // ----- scheduling ------------------------------------------------------------
  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; timerAt = 0; } }
  function schedule(ms) {
    if (!started) return;
    const now = Date.now();
    let at = now + ms;
    if (backoffUntil > at) at = backoffUntil;     // never retry sooner than the backoff allows
    clearTimer();
    timerAt = at;
    timer = setTimeout(() => { timer = null; timerAt = 0; flush(false); }, Math.max(0, at - now));
    if (timer && timer.unref) timer.unref();
  }

  // ----- network ---------------------------------------------------------------
  async function post(action, body, over) {
    const c = over || cfg();
    if (!/^https?:\/\//i.test(c.url || '') || !c.token) throw new Error('ยังไม่ได้ตั้งค่า Google Sheet (ใส่ URL เว็บแอปที่ขึ้นต้นด้วย https:// และโทเคนก่อน)');
    let res;
    try {
      res = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: c.token, action }, body || {})),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('เชื่อมต่อ Google Sheet ไม่ได้ — เช็คอินเทอร์เน็ตและ URL เว็บแอป');
    }
    let json = null;
    try {
      if (typeof res.text === 'function') json = JSON.parse(await res.text());
      else json = await res.json();
    } catch (e) { json = null; }
    if (!json || typeof json !== 'object') {
      throw new Error(res && res.status && res.status !== 200 ? 'เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ')' : 'คำตอบจาก Google Sheet ไม่ถูกต้อง — เช็ค URL เว็บแอป (ต้อง Deploy แบบ Anyone)');
    }
    if (!json.ok) throw new Error(String(json.error || 'ซิงค์ไม่สำเร็จ'));
    return json;
  }
  function settingsPayload() {
    const s = (store.state && store.state.settings) || {};
    const h = Number(s.reminder_hour);
    return { shop_name: s.shop_name || '', reminder_hour: Number.isFinite(h) ? h : 9, calendar_enabled: s.calendar_enabled !== false };
  }

  // Build the next chunk from the queue: returns {body, sent} or null when nothing is left.
  function nextChunk(maxSeq) {
    const body = { orders: [], plants: [], customers: [], deleted: { plants: [], customers: [] }, settings: settingsPayload() };
    const sent = { orders: [], plants: [], customers: [], dplants: [], dcustomers: [] };
    let any = false;
    const take = (key, limit, fn) => {
      for (const [id, s] of Array.from(q[key].entries())) {
        if (sent[key].length >= limit) break;
        if (s > maxSeq) continue;                // re-dirtied after this flush began: next (debounced) flush
        sent[key].push([id, s]);                 // acked even when the doc is gone locally (nothing to send)
        fn(id);
        any = true;
      }
    };
    take('orders', CHUNK.orders, id => { const o = store.getOrder(id); if (o) body.orders.push(o); });
    take('plants', CHUNK.plants, id => { const p = store.getPlant(id); if (p) body.plants.push(stripThumb(p)); });
    take('customers', CHUNK.customers, id => {
      const c = store.getCustomer(id);
      if (!c) return;
      if (c.deleted) body.deleted.customers.push(id); else body.customers.push(c);
    });
    take('dplants', CHUNK.plants, id => body.deleted.plants.push(id));
    take('dcustomers', CHUNK.customers, id => { if (body.deleted.customers.indexOf(id) < 0) body.deleted.customers.push(id); });
    return any ? { body, sent } : null;
  }

  function fail(e) {
    lastError = (e && e.message) || String(e);
    failures++;
    const delay = Math.min(backoffMax, backoffMin * Math.pow(2, failures - 1));
    backoffUntil = Date.now() + delay;
    schedule(delay);
  }

  // Flush the whole queue (chunk by chunk). force=true ignores the backoff (explicit user action / back online).
  function flush(force) {
    if (inflight) return inflight;
    if (pushing) return Promise.resolve();
    if (!configured() || !online() || !pendingCount()) return Promise.resolve();
    if (!force && Date.now() < backoffUntil) { schedule(backoffUntil - Date.now()); return Promise.resolve(); }
    inflight = (async () => {
      busy = true; emit();
      const maxSeq = seq;
      try {
        for (;;) {
          const chunk = nextChunk(maxSeq);
          if (!chunk) break;
          await post('sync', chunk.body);
          ack(chunk.sent);
          lastOk = new Date().toISOString(); lastError = null; failures = 0; backoffUntil = 0;
          emit();
        }
      } catch (e) {
        try { fail(e); } catch (x) { /* ignore */ }
      } finally {
        busy = false; inflight = null;
        try { emit(); } catch (x) { /* ignore */ }
        // changes made while sending: debounce another flush
        if (started && pendingCount() && !lastError && !timer) schedule(debounceMs);
      }
    })();
    return inflight;
  }

  // ----- public ---------------------------------------------------------------
  function start() {
    if (started) return;
    started = true;
    loadQueue();
    lastOnline = online();
    if (store && typeof store.onLocalChange === 'function') unsubLocal = store.onLocalChange(onLocal);
    if (store && typeof store.subscribe === 'function') {
      unsubStore = store.subscribe(() => {
        try {
          const on = online();
          if (on && !lastOnline) { lastOnline = on; flush(true); }
          lastOnline = on;
          // settings may have just become configured while ids were waiting
          if (!timer && !busy && pendingCount() && configured()) schedule(debounceMs);
          emit();
        } catch (e) { /* ignore */ }
      });
    }
    if (typeof globalThis.addEventListener === 'function') {
      onlineHandler = () => { lastOnline = true; flush(true); };
      globalThis.addEventListener('online', onlineHandler);
    }
    if (periodicMs > 0) {
      periodic = setInterval(() => { if (pendingCount()) flush(false); }, periodicMs);
      if (periodic && periodic.unref) periodic.unref();
    }
    emit();
    if (pendingCount()) flush(false);
  }
  function stop() {
    started = false;
    clearTimer();
    if (periodic) { clearInterval(periodic); periodic = null; }
    if (unsubLocal) { unsubLocal(); unsubLocal = null; }
    if (unsubStore) { unsubStore(); unsubStore = null; }
    if (onlineHandler && typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }

  async function syncNow() {
    try { await flush(true); } catch (e) { /* never throws */ }
  }

  async function pushAll(onProgress) {
    if (!configured()) throw new Error('ยังไม่ได้ตั้งค่า Google Sheet (ใส่ URL เว็บแอปและโทเคนก่อน)');
    if (!online()) throw new Error('ออฟไลน์อยู่ — ต่ออินเทอร์เน็ตก่อนแล้วลองใหม่');
    if (inflight) { try { await inflight; } catch (e) { /* ignore */ } }
    if (busy) throw new Error('กำลังซิงค์อยู่ ลองใหม่อีกครั้ง');
    busy = true; pushing = true; emit();
    const startSeq = seq;
    try {
      const all = await store.exportAll();
      const orders = all.orders || [];
      const plants = (all.plants || []).filter(p => p && p.name).map(stripThumb);
      const custAll = all.customers || [];
      const customers = custAll.filter(c => !c.deleted);
      const delCust = custAll.filter(c => c.deleted).map(c => c.id);
      const total = orders.length + plants.length + customers.length;
      let done = 0;
      const progress = () => { try { if (typeof onProgress === 'function') onProgress(done, total); } catch (e) { /* ignore */ } };
      progress();
      let io = 0, ip = 0, ic = 0, first = true;
      while (io < orders.length || ip < plants.length || ic < customers.length || first) {
        const o = orders.slice(io, io + CHUNK.orders);
        const p = plants.slice(ip, ip + CHUNK.plants);
        const c = customers.slice(ic, ic + CHUNK.customers);
        const body = { orders: o, plants: p, customers: c, deleted: { plants: [], customers: first ? delCust : [] }, settings: settingsPayload() };
        first = false;
        await post('sync', body);
        io += o.length; ip += p.length; ic += c.length;
        done += o.length + p.length + c.length;
        progress();
      }
      // everything dirty before the snapshot is now covered
      // (deleted plants are not part of an export, so dplants stay queued; dcustomers only when they were sent above)
      KEYS.forEach(k => {
        if (k === 'dplants') return;
        Array.from(q[k].entries()).forEach(([id, s]) => { if (s <= startSeq && (k !== 'dcustomers' || delCust.indexOf(id) >= 0)) q[k].delete(id); });
      });
      saveQueue();
      lastOk = new Date().toISOString(); lastError = null; failures = 0; backoffUntil = 0;
      return { orders: orders.length, plants: plants.length, customers: customers.length };
    } catch (e) {
      lastError = (e && e.message) || String(e);
      throw e;
    } finally {
      busy = false; pushing = false;
      emit();
      if (started && pendingCount() && !timer) schedule(debounceMs);
    }
  }

  // over = optional {url, token} to test values not saved yet
  async function test(over) {
    const c = over || cfg();
    if (!c.url || !c.token) throw new Error('ยังไม่ได้ตั้งค่า Google Sheet (ใส่ URL เว็บแอปและโทเคนก่อน)');
    const r = await post('ping', {}, { url: String(c.url).trim(), token: String(c.token).trim() });
    return { ok: true, sheet_url: r.sheet_url || '' };
  }

  async function fetchLegacy() {
    if (!configured()) throw new Error('ยังไม่ได้ตั้งค่า Google Sheet (ใส่ URL เว็บแอปและโทเคนก่อน)');
    const r = await post('legacy_export', {});
    return r.data || {};
  }

  loadQueue();
  return { start, stop, status, onStatus, syncNow, pushAll, test, fetchLegacy };
}

export default createBridge;
