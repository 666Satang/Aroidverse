// push.js — Web Push registration on this device (SPEC5). Firebase messaging is loaded lazily from gstatic, only when needed.
// Every failure is a Thai Error. enablePush() must be called straight from a click: Notification.requestPermission() is its first call.

const SDK = 'https://www.gstatic.com/firebasejs/12.12.0/';
const LS_TOKEN = 'plantapp_push_token';
const LS_CHECKED = 'plantapp_push_checked';
const DAY = 24 * 3600 * 1000;

const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  try {
    if (navigator.standalone) return true;
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch (e) { return false; }
}
const permission = () => (typeof Notification !== 'undefined' ? Notification.permission : 'denied');

export async function pushSupport() {
  const perm = permission();
  const ios = isIOS();
  if (ios && !isStandalone()) return { supported: false, reason: 'ios-not-installed', permission: perm };
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || typeof PushManager === 'undefined' || !('PushManager' in window)) {
    return { supported: false, reason: 'unsupported', permission: perm };
  }
  if (perm === 'denied') return { supported: false, reason: 'denied', permission: perm };
  return { supported: true, reason: '', permission: perm };
}

export function getSavedToken() { return lsGet(LS_TOKEN); }

async function loadSdk() {
  try {
    const [app, msg] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-messaging.js')]);
    return { app, msg };
  } catch (e) {
    throw new Error('โหลดบริการแจ้งเตือนไม่สำเร็จ — เช็คอินเทอร์เน็ตแล้วลองใหม่');
  }
}

async function fetchToken(vapidKey, requestPerm) {
  const { app, msg } = await loadSdk();
  let ok = false;
  try { ok = await msg.isSupported(); } catch (e) { ok = false; }
  if (!ok) throw new Error('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน Push');
  let fbApp;
  try { fbApp = app.getApp(); } catch (e) { throw new Error('ยังไม่ได้เชื่อมต่อฐานข้อมูล — เข้าสู่ระบบก่อนแล้วลองใหม่'); }
  let reg;
  try { reg = await navigator.serviceWorker.ready; } catch (e) { throw new Error('บริการเบื้องหลังของแอปยังไม่พร้อม — ปิดแล้วเปิดแอปใหม่'); }
  let token = '';
  try {
    token = await msg.getToken(msg.getMessaging(fbApp), { vapidKey, serviceWorkerRegistration: reg });
  } catch (e) {
    const m = String((e && (e.code || e.message)) || '');
    if (/permission-blocked|denied/i.test(m)) throw new Error('ถูกปิดสิทธิ์แจ้งเตือน — ไปเปิดในตั้งค่าเครื่องแล้วลองใหม่');
    if (/token-subscribe|network|fetch|offline/i.test(m)) throw new Error('ขอโทเคนแจ้งเตือนไม่สำเร็จ — เช็คอินเทอร์เน็ตและ Web Push key แล้วลองใหม่');
    if (/vapid|applicationServerKey|invalid/i.test(m)) throw new Error('Web Push key (VAPID) ไม่ถูกต้อง — ตรวจสอบที่ Firebase Console → Cloud Messaging');
    throw new Error('เปิดการแจ้งเตือนไม่สำเร็จ: ' + (e && e.message ? e.message : m));
  }
  if (!token) throw new Error('ไม่ได้รับโทเคนแจ้งเตือน — ลองใหม่อีกครั้ง');
  return token;
}

export async function enablePush(opts) {
  // iOS gesture rule: nothing awaited before this call
  let permP = null;
  try { if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') permP = Notification.requestPermission(); } catch (e) { permP = null; }
  const vapidKey = String((opts && opts.vapidKey) || '').trim();
  let perm = permission();
  if (permP) { try { perm = await permP; } catch (e) { perm = permission(); } }
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || typeof PushManager === 'undefined') {
    const sup = await pushSupport();
    throw new Error(sup.reason === 'ios-not-installed' ? 'บน iPhone/iPad ต้องเปิดแอปจากไอคอนบนหน้าจอโฮมก่อน' : 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน Push');
  }
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'ถูกปิดสิทธิ์แจ้งเตือน — ไปเปิดในตั้งค่าเครื่องแล้วลองใหม่' : 'ยังไม่ได้อนุญาตการแจ้งเตือน');
  if (!vapidKey) throw new Error('ยังไม่ได้ใส่ Web Push key (VAPID) — ใส่ในช่องด้านบนแล้วกดบันทึกก่อน');
  const token = await fetchToken(vapidKey);
  lsSet(LS_TOKEN, token); lsSet(LS_CHECKED, String(Date.now()));
  return token;
}

export async function disablePush() {
  const old = lsGet(LS_TOKEN);
  try {
    const { app, msg } = await loadSdk();
    await msg.deleteToken(msg.getMessaging(app.getApp()));
  } catch (e) { /* the token is forgotten locally anyway; the server drops dead tokens itself */ }
  lsDel(LS_TOKEN); lsDel(LS_CHECKED);
  return old;
}

// Daily silent refresh. Returns {token, changed, old} or null when nothing was done. Never throws.
export async function refreshTokenIfDue(vapidKey, force) {
  try {
    const old = lsGet(LS_TOKEN);
    if (!old || !vapidKey || permission() !== 'granted') return null;
    const last = Number(lsGet(LS_CHECKED)) || 0;
    if (!force && Date.now() - last < DAY) return null;
    const token = await fetchToken(String(vapidKey).trim());
    lsSet(LS_CHECKED, String(Date.now()));
    if (token !== old) { lsSet(LS_TOKEN, token); return { token, changed: true, old }; }
    return { token, changed: false, old };
  } catch (e) { return null; }
}

// Short human label for the Devices tab in the sheet
export function deviceLabel() {
  const ua = navigator.userAgent || '';
  let n = 'อุปกรณ์';
  if (/iPhone/.test(ua)) n = 'iPhone'; else if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) n = 'iPad';
  else if (/Android/.test(ua)) n = 'Android'; else if (/Windows/.test(ua)) n = 'Windows'; else if (/Mac/.test(ua)) n = 'Mac'; else if (/Linux/.test(ua)) n = 'Linux';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return n + (b ? ' ' + b : '') + (isStandalone() ? ' (แอป)' : '');
}
