// Boot, auth screens, shell, tab router. All business logic lives in store.js.
import { ctx, $, esc, icon, toast, openSheet, bind, closeAllSheets, refreshLiveSheets, errMsg, confirmDlg } from './ui-core.js';
import { homeView } from './ui-home.js';
import { ordersView } from './ui-orders.js';
import { plantsView, customersView, openCustomerForm, openPlantForm } from './ui-lists.js';
import { menuView, reportsView, settingsView } from './ui-menu.js';

const LS_KEY = 'plantapp_fb_config';
const params = new URLSearchParams(location.search);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- service worker
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'updated') toast('มีเวอร์ชันใหม่ แตะเพื่ออัปเดต', false, { sticky: true, cls: 'upd', onclick: () => location.reload() });
  });
}

// ---------------------------------------------------------------- screens
function hideSplash() { const s = $('#splash'); s.classList.add('off'); setTimeout(() => { s.hidden = true; }, 300); }
function showScreen(html, bindFn) {
  $('#shell').hidden = true; const sc = $('#screen'); sc.hidden = false; sc.innerHTML = html; hideSplash(); if (bindFn) bindFn(sc);
}
const LOGO = '<div class="logo">' + icon('leaf') + '</div>';

function parseConfig(text) {
  const out = {}, re = /["']?([A-Za-z][A-Za-z0-9_]*)["']?\s*:\s*["']([^"']*)["']/g; let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}
function showSetup(note) {
  showScreen('<div class="auth">' + LOGO + '<h1>เชื่อมต่อฐานข้อมูล</h1><p class="lead">วางค่า <b>firebaseConfig</b> ที่คัดลอกมาจาก Firebase Console (Project settings → Your apps) ลงในช่องด้านล่าง ทำครั้งเดียวต่อเครื่อง</p>' +
    '<div class="card">' + (note ? '<div class="err">' + esc(note) + '</div>' : '') + '<textarea id="cfg" placeholder="const firebaseConfig = {\n  apiKey: &quot;...&quot;,\n  authDomain: &quot;...&quot;,\n  projectId: &quot;...&quot;,\n  appId: &quot;...&quot;\n};" spellcheck="false" autocapitalize="off"></textarea><div class="err" id="cfg-err" hidden></div><button class="btn block" id="cfg-ok">บันทึกและเริ่มใช้งาน</button></div>' +
    '<div class="foot"><a class="link" href="?demo=1">ลองโหมดตัวอย่าง (ไม่ต้องตั้งค่า)</a></div></div>', (sc) => {
    $('#cfg-ok', sc).onclick = () => {
      const c = parseConfig($('#cfg', sc).value), miss = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !c[k]);
      if (miss.length) { const e = $('#cfg-err', sc); e.hidden = false; e.textContent = 'ยังขาดค่า: ' + miss.join(', ') + ' — ลองคัดลอกทั้งก้อน firebaseConfig มาวางใหม่'; return; }
      lsSet(LS_KEY, JSON.stringify(c)); location.reload();
    };
  });
}
function showLogin(adapter) {
  showScreen('<div class="auth">' + LOGO + '<h1>เข้าสู่ระบบ</h1><p class="lead">ใช้อีเมลและรหัสผ่านที่ตั้งไว้ใน Firebase</p><form class="card" id="lf"><label class="fld" style="margin-top:0">อีเมล</label><input id="l-em" type="email" autocomplete="username" autocapitalize="off" inputmode="email"><label class="fld">รหัสผ่าน</label><input id="l-pw" type="password" autocomplete="current-password"><div class="err" id="l-err" hidden></div><button class="btn block" id="l-ok" type="submit">เข้าสู่ระบบ</button></form>' +
    '<div class="foot"><button class="link" id="l-reset" type="button">ตั้งค่า Firebase ใหม่</button></div></div>', (sc) => {
    $('#lf', sc).onsubmit = async (e) => {
      e.preventDefault();
      const b = $('#l-ok', sc), er = $('#l-err', sc); b.disabled = true; er.hidden = true; b.textContent = 'กำลังเข้าสู่ระบบ…';
      try { await adapter.signIn($('#l-em', sc).value.trim(), $('#l-pw', sc).value); }
      catch (x) { er.hidden = false; er.textContent = errMsg(x); b.disabled = false; b.textContent = 'เข้าสู่ระบบ'; }
    };
    $('#l-reset', sc).onclick = () => { lsDel(LS_KEY); location.reload(); };
  });
}
function showFatal(e) {
  showScreen('<div class="auth">' + LOGO + '<h1>เปิดแอปไม่สำเร็จ</h1><p class="lead">' + esc(errMsg(e)) + '</p><button class="btn block" id="f-retry">ลองใหม่</button><div class="foot"><button class="link" id="f-reset" type="button">ตั้งค่า Firebase ใหม่</button> · <a class="link" href="?demo=1">โหมดตัวอย่าง</a></div></div>', (sc) => {
    $('#f-retry', sc).onclick = () => location.reload();
    $('#f-reset', sc).onclick = () => { lsDel(LS_KEY); location.reload(); };
  });
}

// ---------------------------------------------------------------- shell / router
const TABS = [['home', 'หน้าหลัก', 'home'], ['orders', 'ออเดอร์', 'list'], ['plus'], ['plants', 'ต้นไม้', 'leaf'], ['menu', 'เมนู', 'menu']];
const SUB_TITLES = { customers: 'ลูกค้า', reports: 'รายงานยอดขาย', settings: 'ตั้งค่า' };
let tab = 'home', cur = null, curEl = null, raf = 0;

function currentView() {
  if (tab === 'home') return homeView;
  if (tab === 'orders') return ordersView;
  if (tab === 'plants') return plantsView;
  return { customers: customersView, reports: reportsView, settings: settingsView }[ctx.ui.menu] || menuView;
}
function renderTabbar() {
  $('#tabbar').innerHTML = '<div class="tabbar-in">' + TABS.map((t) => t.length === 1
    ? '<button class="plus" data-act="plus" aria-label="สร้างใหม่">' + icon('plus') + '</button>'
    : '<button class="tab' + (t[0] === tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + icon(t[2]) + '<span>' + t[1] + '</span></button>').join('') + '</div>';
}
function renderHeader() {
  const st = ctx.store.state, sub = tab === 'menu' && ctx.ui.menu;
  const title = sub ? SUB_TITLES[sub] : tab === 'home' ? (st.settings.shop_name || 'Plant Orders') : { orders: 'ออเดอร์', plants: 'ต้นไม้', menu: 'เมนู' }[tab];
  const stat = !st.online ? '<span class="stat off">ออฟไลน์</span>' : st.pending ? '<span class="stat sync">กำลังซิงค์…</span>' : ctx.demo ? '<span class="stat demo">โหมดตัวอย่าง</span>' : '';
  const key = [tab, sub, title, stat].join('|'), top = $('#top');
  if (top._key === key) return; top._key = key;
  top.innerHTML = '<div class="top-in">' + (sub ? '<button class="back" data-act="back" aria-label="กลับ">' + icon('back') + '</button>' : '') +
    '<div class="brand">' + (sub ? '' : '<span class="mark">' + icon('leaf') + '</span>') + '<span>' + esc(title) + '</span></div>' + stat +
    (sub === 'customers' ? '<button class="btn sec sm" data-act="addcust">' + icon('plus') + ' เพิ่ม</button>' : '') + '</div>';
}
function mountView() {
  cur = currentView();
  const old = $('#view'), el = document.createElement('main'); el.id = 'view'; el.className = 'view';
  old.replaceWith(el); curEl = el;
  cur.mount(el); renderHeader(); renderTabbar();
  window.scrollTo(0, 0);
}
function pass() {
  raf = 0; if (!cur) return;
  renderHeader();
  try { if (cur.update) cur.update(curEl); } catch (e) { console.error(e); }
  refreshLiveSheets();
}
function schedule() { if (!raf) raf = requestAnimationFrame(pass); }

function goTab(name) {
  if (name === 'menu' && tab === 'menu' && ctx.ui.menu) { ctx.ui.menu = null; mountView(); return; }
  if (name === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  tab = name; if (name !== 'menu') ctx.ui.menu = null;
  mountView();
}
ctx.nav = {
  tab: goTab,
  menu(v) { tab = 'menu'; ctx.ui.menu = v; closeAllSheets(); mountView(); },
  orders(f) { closeAllSheets(); ctx.ui.of = f || 'all'; ctx.ui.oq = ''; ctx.ui.limO = 60; tab = 'orders'; ctx.ui.menu = null; mountView(); },
  rerender: schedule,
};

function openPlus() {
  const s = openSheet({
    title: 'สร้างใหม่',
    build(sh) {
      const a = (k, ic, tone, t, sub) => '<button class="act" data-act="' + k + '"><span class="ic ' + tone + '">' + icon(ic) + '</span><span><span class="t" style="display:block">' + t + '</span><span class="sub">' + sub + '</span></span></button>';
      sh.body.innerHTML = a('order', 'list', '', 'ออเดอร์ใหม่', 'จากแชท Facebook / Instagram') + a('quick', 'bolt', 'peach', 'ขายหน้าร้านด่วน', 'เลือกต้นไม้ แล้วบันทึก จบใน 3 แตะ') + a('import', 'camera', 'sky', 'นำเข้าจากรูปจดขาย', 'ถ่ายรูปสมุดจด ให้ AI อ่านเป็นออเดอร์') + a('plant', 'leaf', 'lilac', 'เพิ่มต้นไม้', 'ใส่ชื่อ ราคา และรูป');
    },
  });
  bind(s.body, {
    order: () => { s.close(); import('./ui-form.js').then((m) => m.openOrderForm()); },
    quick: () => { s.close(); import('./ui-form.js').then((m) => m.openOrderForm({ quick: true })); },
    import: () => { s.close(); if (formMod) formMod.startImport(); else import('./ui-form.js').then((m) => m.startImport()); },
    plant: () => { s.close(); openPlantForm(''); },
  });
}

// pre-warm the form module so "import" can open the file picker synchronously inside the tap
let formMod = null;
function warm() { import('./ui-form.js').then((m) => { formMod = m; }); import('./ui-orders.js'); }

function showApp(store) {
  $('#screen').hidden = true; $('#shell').hidden = false;
  $('#tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
    if (t.dataset.act === 'plus') openPlus(); else if (t.dataset.tab) goTab(t.dataset.tab);
  });
  $('#top').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'back') { ctx.ui.menu = null; mountView(); } else if (t.dataset.act === 'addcust') openCustomerForm('');
  });
  store.subscribe(schedule);
  if (store.onError) store.onError((e) => toast(errMsg(e), true));
  mountView(); hideSplash(); warm();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { if (store.checkRollover) store.checkRollover(); } catch (e) { /* ignore */ } schedule(); } });
}

// ---------------------------------------------------------------- boot
async function getConfig() {
  try { const m = await import('./config.js'); if (m.FIREBASE_CONFIG) return m.FIREBASE_CONFIG; } catch (e) { /* no config.js */ }
  const raw = lsGet(LS_KEY); if (!raw) return null;
  try { const c = JSON.parse(raw); return c && c.apiKey ? c : null; } catch (e) { return null; }
}

async function boot() {
  registerSW();
  ctx.demo = params.get('demo') === '1';
  let adapter;
  if (ctx.demo) {
    const m = await import('./adapter-mock.js'); adapter = m.default({ seed: true });
  } else {
    const cfg = await getConfig();
    if (!cfg) return showSetup();
    const m = await import('./adapter-fire.js'); adapter = m.default({ config: cfg });
  }
  ctx.adapter = adapter;
  const { createStore } = await import('./store.js');
  const store = createStore(adapter); ctx.store = store;
  await adapter.init();
  let started = false;
  adapter.onAuth(async (user) => {
    if (!user) { if (started) { location.reload(); return; } showLogin(adapter); return; }
    if (started) return; started = true;
    try { await store.start(); showApp(store); } catch (e) { showFatal(e); }
  });
}
boot().catch((e) => { console.error(e); try { showFatal(e); } catch (x) { /* ignore */ } });
