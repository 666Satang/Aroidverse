// printer.js — direct Bluetooth label printing (NIIMBOT B21 Pro) through the open-source library @mmote/niimbluelib.
// The library is loaded at runtime from a CDN (no top-level import) and its API differs between versions, so every
// property is feature-detected and every step is written to a rolling log (printerLog()) the owner can copy and send back.
// connectPrinter() / printCanvas() must be called from a click handler (the browser device chooser needs a user gesture),
// so nothing slow is awaited before client.connect(): call preloadPrinterLib() earlier (sheet / settings / order opening).

const LIB_VERSION = '0.49.0';
const LIB_URLS = [
  'https://cdn.jsdelivr.net/npm/@mmote/niimbluelib@' + LIB_VERSION + '/+esm',
  'https://esm.sh/@mmote/niimbluelib@' + LIB_VERSION,
];
const DEFAULT_TASK = 'D110M_V4';
const JOB_TIMEOUT_MS = 60000;
const MAX_LOG = 200;

// ---------------------------------------------------------------- Thai messages
const MSG = {
  noLib: 'โหลดไดรเวอร์เครื่องพิมพ์ไม่ได้ — ต้องต่ออินเทอร์เน็ตครั้งแรก',
  cancelled: 'ยังไม่ได้เลือกเครื่องพิมพ์',
  gesture: 'Bluetooth ถูกบล็อก — ต้องกดปุ่มเพื่อเชื่อมต่อเครื่องพิมพ์โดยตรง',
  dropped: 'การเชื่อมต่อหลุด ลองกดพิมพ์อีกครั้ง',
  timeout: 'เครื่องพิมพ์ไม่ตอบสนอง',
  ios: 'iPhone/iPad พิมพ์ตรงผ่าน Bluetooth ไม่ได้ — ใช้ปุ่มแชร์ไปแอป NIIMBOT',
  insecure: 'ต้องเปิดแอปผ่าน https เพื่อใช้ Bluetooth',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Chrome บน Android หรือคอมพิวเตอร์',
  fail: (m) => 'พิมพ์ไม่สำเร็จ: ' + m,
};

class PrinterError extends Error {
  constructor(message, code, cause) { super(message); this.name = 'PrinterError'; this.code = code || ''; if (cause) this.cause = cause; }
}

// ---------------------------------------------------------------- log
const lines = [];
const pad2 = (n, w) => String(n).padStart(w || 2, '0');
function stamp() { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + pad2(d.getMilliseconds(), 3); }
function short(v, max) {
  max = max || 400;
  let s;
  try {
    const seen = new WeakSet();
    s = JSON.stringify(v, (k, x) => {
      if (typeof x === 'function') return '[fn]';
      if (typeof x === 'bigint') return String(x);
      if (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) return '[canvas ' + x.width + 'x' + x.height + ']';
      if (x && typeof x === 'object') {
        if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return '[bytes ' + (x.byteLength) + ']';
        if (seen.has(x)) return '[circular]';
        seen.add(x);
      }
      return x;
    });
  } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max) + '…(' + s.length + ')' : s;
}
function log(msg) {
  lines.push(stamp() + ' ' + msg);
  if (lines.length > MAX_LOG) lines.splice(0, lines.length - MAX_LOG);
}
const errStr = (e) => (e && (e.name ? e.name + ': ' : '') + (e.message || e)) || String(e);
function logErr(where, e) {
  log('✗ ' + where + ' — ' + errStr(e) + (e && e.code ? ' [code=' + e.code + ']' : ''));
  if (e && e.stack && !(e instanceof PrinterError)) log('  stack: ' + String(e.stack).split('\n').slice(0, 4).join(' | '));
}
// await one step with a log line before and after (result summary or error)
async function step(name, fn) {
  log('→ ' + name);
  try { const r = await fn(); log('← ' + name + ' ok' + (r === undefined ? '' : ': ' + short(r, 300))); return r; }
  catch (e) { logErr(name, e); throw e; }
}
export function printerLog() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const head = ['# Plant Orders printer log', '# ' + new Date().toISOString(), '# UA: ' + (nav.userAgent || '?'), '# support: ' + short(printerSupport()), '# lib: ' + LIB_VERSION + ' via ' + LIB_URLS.join(' , ')];
  return head.concat(lines).join('\n');
}
export function clearPrinterLog() { lines.length = 0; }

// ---------------------------------------------------------------- support
export function printerSupport() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav) return { bluetooth: false, reason: 'unsupported' };
  const ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (ios) return { bluetooth: false, reason: 'ios' };
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) return { bluetooth: false, reason: 'insecure' };
  if (!nav.bluetooth) return { bluetooth: false, reason: 'unsupported' };
  return { bluetooth: true, reason: '' };
}
export function printerUnsupportedText(reason) {
  return reason === 'ios' ? MSG.ios : reason === 'insecure' ? MSG.insecure : MSG.unsupported;
}

// ---------------------------------------------------------------- state
const state = { connected: false, connecting: false, printing: false, name: '', info: null, lastError: '', progress: null };
const listeners = new Set();
export function printerState() { return Object.assign({}, state, { info: state.info ? Object.assign({}, state.info) : null }); }
export function onPrinterState(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { const s = printerState(); listeners.forEach((cb) => { try { cb(s); } catch (e) { /* ignore */ } }); }
function set(patch) { Object.assign(state, patch); emit(); }

// ---------------------------------------------------------------- library loading
let libPromise = null, libAttempt = 0, libUrlUsed = '';
const normalize = (m) => {
  if (!m) return m;
  const direct = !!(m.NiimbotBluetoothClient || m.instantiateClient);
  const L = direct ? m : (m.default || m);
  return L;
};
export function loadPrinterLib() {
  if (libPromise) return libPromise;
  const attempt = libAttempt++;
  libPromise = (async () => {
    let lastErr = null;
    for (const base of LIB_URLS) {
      // a failed dynamic import is cached per URL by the browser; a fragment gives retries a fresh module-map entry
      const url = attempt > 0 ? base + '#retry' + attempt : base;
      try {
        log('→ import ' + url);
        const m = await import(/* webpackIgnore: true */ url);
        const L = normalize(m);
        libUrlUsed = url;
        log('← import ok: ' + url);
        log('module keys: ' + short(Object.keys(m)) + (m.default && m.default !== m ? ' | default keys: ' + short(Object.keys(m.default)) : '') + ' | using ' + (L === m ? 'namespace' : '.default'));
        return { m, L };
      } catch (e) { lastErr = e; logErr('import ' + url, e); }
    }
    throw new PrinterError(MSG.noLib, 'nolib', lastErr);
  })();
  libPromise.catch(() => { libPromise = null; }); // allow a retry on the next click
  return libPromise;
}
// fire-and-forget warm-up (never throws, never blocks)
export function preloadPrinterLib() {
  try { if (!printerSupport().bluetooth) return; loadPrinterLib().catch(() => {}); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- helpers
const timeoutMs = () => { const t = typeof globalThis !== 'undefined' ? Number(globalThis.__PRINTER_TIMEOUT_MS) : NaN; return Number.isFinite(t) && t > 0 ? t : JOB_TIMEOUT_MS; };
const isFn = (f) => typeof f === 'function';
function protoNames(o) {
  const names = new Set();
  try { for (let p = o, i = 0; p && p !== Object.prototype && i < 5; p = Object.getPrototypeOf(p), i++) Object.getOwnPropertyNames(p).forEach((n) => { if (n !== 'constructor') names.add(n); }); } catch (e) { /* ignore */ }
  return Array.from(names);
}
function race(p, ms, onTimeout) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(onTimeout()), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
}
// best-effort call: never throws, short timeout, result logged
async function soft(name, fn, ms) {
  try {
    log('→ ' + name);
    const r = await race(Promise.resolve().then(fn), ms || 4000, () => new Error('timeout ' + (ms || 4000) + 'ms'));
    log('← ' + name + ': ' + short(r, 300));
    return r;
  } catch (e) { log('· ' + name + ' failed (ignored): ' + errStr(e)); return undefined; }
}
function findNum(obj, re) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of Object.keys(obj)) { if (re.test(k) && typeof obj[k] === 'number' && Number.isFinite(obj[k])) return obj[k]; }
  return undefined;
}

// map any failure to a Thai message (PrinterError keeps its message)
function toThai(e) {
  if (e instanceof PrinterError) return e;
  const name = e && e.name, msg = String((e && e.message) || e || '');
  if (name === 'NotFoundError' || /user cancelled|chooser|no device selected|cancelled the request/i.test(msg)) return new PrinterError(MSG.cancelled, 'cancelled', e);
  if (name === 'SecurityError' || /user gesture|not allowed to access|permissions policy/i.test(msg)) return new PrinterError(MSG.gesture, 'gesture', e);
  if (name === 'NetworkError' || /GATT|disconnect|not connected|device is not|connection (lost|closed)/i.test(msg)) return new PrinterError(MSG.dropped, 'dropped', e);
  return new PrinterError(MSG.fail(msg || name || 'unknown'), 'fail', e);
}

// ---------------------------------------------------------------- client
let client = null, lib = null, dropReject = null, lastProgressLog = 0, lastBattery;

function dropClient() { client = null; }

function wireEvents(c) {
  if (!isFn(c.addEventListener)) { log('client has no addEventListener — events skipped'); return; }
  const on = (name, fn) => { try { c.addEventListener(name, (ev) => { try { fn(ev); } catch (e) { log('· handler ' + name + ' error: ' + errStr(e)); } }); } catch (e) { log('· addEventListener(' + name + ') failed: ' + errStr(e)); } };
  on('connect', (ev) => { log('event connect ' + short(ev && ev.detail, 200)); if (client === c) set({ connected: true, connecting: false }); });
  on('disconnect', () => {
    log('event disconnect');
    if (client === c) { dropClient(); set({ connected: false, connecting: false, progress: null }); }
    if (dropReject) { const r = dropReject; dropReject = null; r(new PrinterError(MSG.dropped, 'dropped')); }
  });
  on('printprogress', (ev) => {
    const d = ev && ev.detail, now = Date.now();
    if (now - lastProgressLog > 400) { lastProgressLog = now; log('event printprogress ' + short(d, 200)); }
    const pct = findNum(d, /progress/i);
    if (typeof pct === 'number') set({ progress: Math.max(0, Math.min(100, Math.round(pct))) });
  });
  const info = (name) => on(name, (ev) => {
    const d = ev && ev.detail;
    const b = findNum(d, /batter/i);
    if (name !== 'heartbeat' || b !== lastBattery) log('event ' + name + ' ' + short(d, 300));
    if (typeof b === 'number' && b >= 0 && b <= 100 && b !== lastBattery) { lastBattery = b; set({ info: Object.assign({}, state.info, { battery: b }) }); }
  });
  info('heartbeat'); info('printerinfofetched');
}

async function readInfo(c) {
  let pi = await soft('getPrinterInfo', () => (isFn(c.getPrinterInfo) ? c.getPrinterInfo() : undefined));
  const meta = await soft('getModelMetadata', () => (isFn(c.getModelMetadata) ? c.getModelMetadata() : undefined));
  const taskAuto = await soft('getPrintTaskType', () => (isFn(c.getPrintTaskType) ? c.getPrintTaskType() : undefined));
  const dev = (() => { try { return (c.device || c.bluetoothDevice || (c.gatt && c.gatt.device) || (c.bluetooth && c.bluetooth.device) || {}).name; } catch (e) { return ''; } })();
  const model = (meta && (meta.model || meta.name)) || (pi && (pi.model || pi.modelName || pi.name)) || '';
  const battery = findNum(pi, /batter/i);
  const name = String(dev || model || 'NIIMBOT');
  const head = meta && typeof meta.printheadPixels === 'number' ? meta.printheadPixels : undefined;
  return { name, meta, pi, head, info: { model: model ? String(model) : undefined, taskAuto: typeof taskAuto === 'string' ? taskAuto : undefined, battery: typeof battery === 'number' && battery >= 0 && battery <= 100 ? battery : undefined, printheadPixels: head } };
}

let connectingP = null;
async function doConnect() {
  const sup = printerSupport();
  if (!sup.bluetooth) throw new PrinterError(printerUnsupportedText(sup.reason), 'unsupported');
  if (client && state.connected) { log('reuse live connection'); return client; }
  set({ connecting: true, lastError: '' });
  try {
    // NOTE: nothing slow may be awaited between the click and client.connect(); the library is normally preloaded already
    const { L } = await loadPrinterLib();
    lib = L;
    log('lib exports (L): ' + short(Object.keys(L || {})));
    let c;
    if (isFn(L.instantiateClient)) { c = L.instantiateClient('bluetooth'); log('client via instantiateClient("bluetooth")'); }
    else if (isFn(L.NiimbotBluetoothClient)) { c = new L.NiimbotBluetoothClient(); log('client via new NiimbotBluetoothClient()'); }
    else throw new PrinterError(MSG.fail('ไดรเวอร์เวอร์ชันนี้ไม่รองรับ (พบ: ' + Object.keys(L || {}).slice(0, 12).join(', ') + ')'), 'noapi');
    if (!c) throw new PrinterError(MSG.fail('สร้างไคลเอนต์เครื่องพิมพ์ไม่ได้'), 'noclient');
    client = c; lastBattery = undefined;
    wireEvents(c);
    await step('client.connect()', () => c.connect());
    if (client !== c) throw new PrinterError(MSG.dropped, 'dropped');
    log('client own keys: ' + short(Object.keys(c)) + ' | methods: ' + short(protoNames(c).slice(0, 80), 900));
    const api = c.abstraction || c.protocol;
    log('api object: ' + (c.abstraction ? 'client.abstraction' : c.protocol ? 'client.protocol' : 'none') + ' | keys: ' + short(api ? Object.keys(api) : []) + ' | methods: ' + short(api ? protoNames(api).slice(0, 80) : [], 900));
    const r = await readInfo(c);
    log('detected shape: ' + (isFn(L.instantiateClient) ? 'B(new: instantiateClient)' : 'A(old: class)') + ' | api=' + (c.abstraction ? 'abstraction' : c.protocol ? 'protocol' : 'none') + ' | encodeCanvas.length=' + (L.ImageEncoder && L.ImageEncoder.encodeCanvas ? L.ImageEncoder.encodeCanvas.length : 'n/a') + ' | PageColorType=' + (L.PageColorType ? 'yes' : 'no'));
    c.__meta = r;
    set({ connected: true, connecting: false, name: r.name, info: r.info, lastError: '' });
    return c;
  } catch (e) {
    const te = toThai(e);
    if (client && !state.connected) dropClient();
    logErr('connect', e);
    set({ connected: false, connecting: false, lastError: te.message });
    throw te;
  }
}

export function connectPrinter() {
  if (connectingP) return connectingP;
  const p = doConnect().then(() => undefined);
  connectingP = p;
  const clear = () => { if (connectingP === p) connectingP = null; };
  p.then(clear, clear);
  return p;
}

export async function disconnectPrinter() {
  log('disconnectPrinter()');
  const c = client;
  dropClient();
  if (c && isFn(c.disconnect)) await soft('client.disconnect', () => c.disconnect());
  set({ connected: false, connecting: false, printing: false, progress: null });
}

// ---------------------------------------------------------------- printing
let tail = Promise.resolve();
function serialise(fn) {
  const p = tail.then(fn, fn);
  tail = p.catch(() => {});
  return p;
}

function prepareCanvas(canvas, direction, headPx) {
  const w = canvas.width, h = canvas.height;
  const head = typeof headPx === 'number' && headPx > 0 ? headPx : 0;
  const along = direction === 'left' ? h : w; // the dimension that ends up on the printhead
  if (head && along > head) throw new PrinterError(MSG.fail('ภาพกว้าง ' + along + ' px แต่หัวพิมพ์รองรับ ' + head + ' px — ลดขนาดสติกเกอร์หรือ DPI'), 'toowide');
  let w8 = Math.ceil(w / 8) * 8, h8 = direction === 'left' ? Math.ceil(h / 8) * 8 : h;
  // padding must not push the image past the printhead (e.g. 591 px head): trim the white margin instead
  let note = '';
  if (head) {
    if (direction === 'left') { if (h8 > head) { h8 = Math.floor(head / 8) * 8; note = ' (trimmed to printhead ' + head + ')'; } }
    else if (w8 > head) { w8 = Math.floor(head / 8) * 8; note = ' (trimmed to printhead ' + head + ')'; }
  }
  if (w8 === w && h8 === h) { log('canvas ' + w + 'x' + h + ' (already multiple of 8)'); return canvas; }
  const out = document.createElement('canvas'); out.width = w8; out.height = h8;
  const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w8, h8); c.drawImage(canvas, 0, 0);
  log('canvas ' + w + 'x' + h + ' -> ' + w8 + 'x' + h8 + ' (multiple of 8, white fill)' + note);
  return out;
}

function encode(L, canvas, direction) {
  const IE = L.ImageEncoder;
  const enc = IE && IE.encodeCanvas;
  if (!isFn(enc)) throw new PrinterError(MSG.fail('ไดรเวอร์ไม่มี ImageEncoder.encodeCanvas (พบ: ' + Object.keys(L).slice(0, 12).join(', ') + ')'), 'noenc');
  const withColor = () => enc.call(IE, canvas, (L.PageColorType && L.PageColorType.SingleColor) ?? 1, direction);
  const plain = () => enc.call(IE, canvas, direction);
  const preferColor = enc.length >= 3 && !!L.PageColorType;
  const first = preferColor ? withColor : plain, second = preferColor ? plain : withColor;
  log('encodeCanvas form: ' + (preferColor ? '(canvas, pageColor, direction)' : '(canvas, direction)') + ' direction=' + direction);
  try { return first(); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    logErr('encodeCanvas first form', e);
    log('retrying encodeCanvas with the other form');
    return second();
  }
}

const clampInt = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

async function runJob(canvas, copies, settings) {
  const sup = printerSupport();
  if (!sup.bluetooth) throw new PrinterError(printerUnsupportedText(sup.reason), 'unsupported');
  if (!canvas || !canvas.width || !canvas.height) throw new PrinterError(MSG.fail('ไม่มีภาพใบปะหน้า'), 'nocanvas');
  const c = await doConnectCached();
  const L = lib;
  const api = c.abstraction || c.protocol;
  if (!api || !isFn(api.newPrintTask)) {
    throw new PrinterError(MSG.fail('ไดรเวอร์เครื่องพิมพ์เวอร์ชันนี้ไม่รองรับ (พบ client: ' + Object.keys(c).slice(0, 10).join(', ') + ' | abstraction/protocol: ' + (api ? Object.keys(api).slice(0, 10).join(', ') : 'ไม่มี') + ')'), 'noapi');
  }
  const direction = settings.printer_direction === 'left' ? 'left' : 'top';
  const density = clampInt(settings.printer_density, 1, 5, 3);
  const labelType = clampInt(settings.printer_label_type, 1, 3, 1);
  const n = clampInt(copies, 1, 99, 1);
  const meta = c.__meta || {};
  const taskAuto = meta.info && meta.info.taskAuto;
  const taskName = String(settings.printer_task || '').trim() || (typeof taskAuto === 'string' && taskAuto) || DEFAULT_TASK;
  log('job: task=' + taskName + (settings.printer_task ? ' (override)' : taskAuto ? ' (auto from printer)' : ' (default)') + ' density=' + density + ' labelType=' + labelType + ' copies=' + n + ' direction=' + direction + ' canvas=' + canvas.width + 'x' + canvas.height);
  const prepared = prepareCanvas(canvas, direction, meta.head);
  const encoded = encode(L, prepared, direction);
  log('encoded: ' + short(encoded && typeof encoded === 'object' ? { keys: Object.keys(encoded), cols: encoded.cols, rows: encoded.rows, rowsData: Array.isArray(encoded.rowsData) ? encoded.rowsData.length : undefined } : encoded, 300));

  await soft('stopHeartbeat', () => (isFn(c.stopHeartbeat) ? c.stopHeartbeat() : undefined), 2000);
  let task = null;
  const guard = new Promise((_, rej) => { dropReject = rej; });
  guard.catch(() => {});
  const ms = timeoutMs();
  try {
    const work = (async () => {
      task = api.newPrintTask(taskName, { totalPages: 1, density, labelType, statusPollIntervalMs: 100, statusTimeoutMs: 8000 });
      log('newPrintTask → ' + (task ? 'task keys: ' + short(Object.keys(task)) + ' methods: ' + short(protoNames(task).slice(0, 40), 400) : 'null'));
      if (!task || !isFn(task.printInit)) throw new PrinterError(MSG.fail('newPrintTask ไม่ได้คืนงานพิมพ์ที่ใช้ได้'), 'notask');
      await step('task.printInit()', () => task.printInit());
      await step('task.printPage(encoded, ' + n + ')', () => task.printPage(encoded, n));
      await step('task.waitForFinished()', () => task.waitForFinished());
    })();
    await race(Promise.race([work, guard]), ms, () => new PrinterError(MSG.timeout, 'timeout'));
    log('job finished');
  } finally {
    dropReject = null;
    await soft('printEnd', async () => {
      if (isFn(api.printEnd)) return api.printEnd();
      if (task && isFn(task.printEnd)) return task.printEnd();
      return 'no printEnd available';
    }, 4000);
    if (client === c) await soft('startHeartbeat', () => (isFn(c.startHeartbeat) ? c.startHeartbeat() : undefined), 2000);
  }
}
const doConnectCached = () => (connectingP ? connectingP.then(() => client) : doConnect());

export function printCanvas(canvas, opts) {
  opts = opts || {};
  const settings = opts.settings || {};
  const copies = opts.copies || 1;
  log('printCanvas called: copies=' + copies + ' canvas=' + (canvas ? canvas.width + 'x' + canvas.height : 'null'));
  return serialise(async () => {
    set({ printing: true, lastError: '', progress: null });
    try { await runJob(canvas, copies, settings); set({ printing: false, progress: null }); }
    catch (e) {
      const te = toThai(e);
      logErr('print', e);
      if (te.code === 'dropped' || te.code === 'timeout') { if (client) { const c = client; dropClient(); if (isFn(c.disconnect)) { try { Promise.resolve(c.disconnect()).catch(() => {}); } catch (x) { /* ignore */ } } } set({ connected: false }); }
      set({ printing: false, progress: null, lastError: te.message });
      throw te;
    }
  });
}
