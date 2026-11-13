// Menu tab, reports (CSV + print), settings, backup.
import { ctx, $, esc, num, str, sum, money, fmtN, fmtDate, MON, MONTHS, icon, toast, openSheet, dialog, confirmDlg, bind, errMsg, busy, emptyHTML, shareOrDownload, downloadBlob, closeAllSheets } from './ui-core.js';
import { orderCard, openOrder } from './ui-orders.js';

// ---------------------------------------------------------------- menu root
export const menuView = {
  mount(el) {
    const row = (act, ic, tone, t, sub) => '<button class="mrow" data-act="' + act + '"><span class="ic ' + tone + '">' + icon(ic) + '</span><span class="grow"><span class="t" style="display:block">' + t + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</span>' + icon('chev', 'chev') + '</button>';
    el.innerHTML = '<div class="menu-list">' + row('customers', 'users', 'sky', 'ลูกค้า', 'รายชื่อและประวัติการสั่งซื้อ') + row('reports', 'chart', 'peach', 'รายงานยอดขาย', 'สรุปรายเดือน ส่งออก CSV / พิมพ์') + row('settings', 'gear', '', 'ตั้งค่า', 'ร้าน บัญชีธนาคาร บิล และ Gemini') + '</div>' +
      '<div class="menu-list">' + row('backup', 'download', 'lilac', 'สำรองข้อมูล', 'ดาวน์โหลดไฟล์ข้อมูลทั้งหมด (JSON)') +
      '<button class="mrow danger" data-act="logout"><span class="ic rose">' + icon('logout') + '</span><span class="grow"><span class="t">' + (ctx.demo ? 'ออกจากโหมดตัวอย่าง' : 'ออกจากระบบ') + '</span></span></button></div>' +
      '<p class="tiny-note" style="text-align:center">Plant Orders · ข้อมูลทั้งหมดบันทึกในเครื่องก่อน แล้วซิงค์เองเมื่อมีเน็ต</p>';
    bind(el, {
      customers: () => ctx.nav.menu('customers'), reports: () => ctx.nav.menu('reports'), settings: () => ctx.nav.menu('settings'),
      backup: doBackup,
      logout: () => dialog(ctx.demo ? 'ออกจากโหมดตัวอย่าง?' : 'ออกจากระบบ?', '<p>' + (ctx.demo ? 'ข้อมูลตัวอย่างจะหายไป' : 'ข้อมูลที่ยังไม่ซิงค์จะถูกส่งขึ้นเมื่อกลับมาออนไลน์ และต้องเข้าสู่ระบบอีกครั้ง') + '</p>', 'ออกจากระบบ', async () => {
        try { await ctx.adapter.signOut(); } catch (e) { /* ignore */ }
        location.href = ctx.demo ? location.pathname : location.pathname + location.search;
      }, { danger: true }),
    });
  },
  update() {},
};

async function doBackup() {
  const end = busy('กำลังรวบรวมข้อมูล…');
  try {
    const data = await ctx.store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const name = 'plant-orders-backup-' + ctx.store.state.today + '.json';
    end();
    const r = await shareOrDownload(blob, name, 'application/json');
    if (r !== 'cancel') toast(r === 'shared' ? 'ส่งไฟล์สำรองข้อมูลแล้ว' : 'ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว');
  } catch (e) { end(); toast(errMsg(e), true); }
}

// ---------------------------------------------------------------- reports
let rep = null, repYear = null, repLoading = false;
const COLS = ['orders', 'plants', 'sales', 'facebook', 'instagram', 'walkin', 'other', 'received', 'outstanding', 'cancelled'];

export const reportsView = {
  mount(el) {
    const S = ctx.store, cur = +S.state.today.slice(0, 4);
    if (repYear == null) repYear = cur;
    el.innerHTML = '<div class="yr"><button data-act="py" aria-label="ปีก่อนหน้า">' + icon('left') + '</button><b id="r-y"></b><button data-act="ny" aria-label="ปีถัดไป">' + icon('right') + '</button><button data-act="rf" aria-label="โหลดใหม่" style="margin-left:6px">' + icon('refresh') + '</button></div><div id="r-body"></div>';
    const load = async (refresh) => {
      repLoading = true; rep = null; this.update(el);
      const y = repYear;
      try { const r = await S.monthlyReport(y, { refresh: !!refresh }); if (y === repYear) rep = r; } catch (e) { toast(errMsg(e), true); }
      repLoading = false; this.update(el);
    };
    el._load = load;
    bind(el, {
      py: () => { repYear--; load(); }, ny: () => { if (repYear < cur) { repYear++; load(); } }, rf: () => load(true),
      month: (d) => openMonth(repYear, +d.m),
      csv: doCsv, print: doPrint,
    });
    load();
  },
  update(el) {
    const cur = +ctx.store.state.today.slice(0, 4);
    $('#r-y', el).textContent = 'ปี ' + repYear;
    $('[data-act="ny"]', el).disabled = repYear >= cur;
    const b = $('#r-body', el);
    if (repLoading || !rep) { b.innerHTML = '<div class="more" style="padding:40px"><span class="spin"></span></div>'; return; }
    const t = rep.total || {}, m = rep.months || [];
    b.innerHTML = '<div class="stats" style="margin-top:16px"><div class="stat-c mint wide"><div class="t"><i></i>ยอดขายปี ' + repYear + '</div><div class="v">' + esc(money(t.sales)) + '</div><div class="s">' + (t.orders || 0) + ' ออเดอร์ · ต้นไม้ ' + (t.plants || 0) + ' ต้น</div></div>' +
      '<div class="stat-c sky"><div class="t"><i></i>รับเงินแล้ว</div><div class="v" style="font-size:22px">' + esc(money(t.received)) + '</div></div><div class="stat-c peach"><div class="t"><i></i>ค้างชำระ</div><div class="v" style="font-size:22px">' + esc(money(t.outstanding)) + '</div></div></div>' +
      '<div class="card" style="padding:8px 4px;margin-top:16px"><table class="rt"><thead><tr><th>เดือน</th><th>ออเดอร์</th><th>ยอดขาย</th><th>รับเงิน</th><th>ค้าง</th></tr></thead><tbody>' +
      m.map((r, i) => '<tr data-act="month" data-m="' + (i + 1) + '"><td>' + MON[i] + '</td>' + [r.orders, r.sales, r.received, r.outstanding].map((v) => '<td class="' + (num(v) ? '' : 'z') + '">' + fmtN(v) + '</td>').join('') + '</tr>').join('') +
      '<tr class="tot"><td>รวม</td>' + [t.orders, t.sales, t.received, t.outstanding].map((v) => '<td>' + fmtN(v) + '</td>').join('') + '</tr></tbody></table></div>' +
      '<div class="sub" style="margin:8px 4px 0">หน่วย: บาท · แตะเดือนเพื่อดูออเดอร์</div>' +
      '<div class="grid2" style="margin-top:16px"><button class="btn sec" data-act="csv">' + icon('table') + ' ส่งออก CSV</button><button class="btn sec" data-act="print">' + icon('print') + ' พิมพ์ / PDF</button></div>';
  },
};

function openMonth(y, mo) {
  const ym = y + '-' + String(mo).padStart(2, '0');
  const s = openSheet({ title: MONTHS[mo - 1] + ' ' + y, live: false, build(sh) { sh.body.innerHTML = '<div class="more" style="padding:40px"><span class="spin"></span></div>'; } });
  ctx.store.loadMonth(ym).then((os) => {
    if (s.closed) return;
    os = (os || []).slice().sort((a, b) => (str(b.order_date) + str(b.code) > str(a.order_date) + str(a.code) ? 1 : -1));
    os.forEach((o) => ctx.extra.set(o.id, o));
    const act = os.filter((o) => o.status !== 'cancelled');
    s.body.innerHTML = os.length ? '<div class="card"><div class="kv"><span>ออเดอร์ (ไม่รวมยกเลิก)</span><b>' + act.length + '</b></div><div class="kv hl"><span>ยอดขาย</span><span>' + esc(money(sum(act, (o) => o.total))) + '</span></div></div><div class="list">' + os.map(orderCard).join('') + '</div>' : emptyHTML('🗓️', 'ไม่มีออเดอร์ในเดือนนี้', '', '', '');
    bind(s.body, { order: (d) => openOrder(d.id) });
  }, (e) => { if (!s.closed) { s.body.innerHTML = '<div class="empty"><div class="t">โหลดไม่สำเร็จ</div><p>' + esc(errMsg(e)) + '</p></div>'; } });
}

const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
async function doCsv() {
  if (!rep) return;
  const head = ['เดือน', 'ออเดอร์', 'ต้นไม้ (ต้น)', 'ยอดขาย', 'Facebook', 'Instagram', 'หน้าร้าน', 'อื่นๆ', 'รับเงิน', 'ค้างชำระ', 'ยกเลิก'];
  const line = (name, r) => [name].concat(COLS.map((k) => num(r[k]))).map(csvCell).join(',');
  const rows = [head.map(csvCell).join(',')].concat((rep.months || []).map((r, i) => line(MONTHS[i], r)), [line('รวม', rep.total || {})]);
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const r = await shareOrDownload(blob, 'sales-report-' + repYear + '.csv', 'text/csv');
  if (r !== 'cancel') toast(r === 'shared' ? 'ส่งไฟล์ CSV แล้ว' : 'ดาวน์โหลด CSV แล้ว');
}
function doPrint() {
  if (!rep) return;
  const t = rep.total || {}, shop = ctx.store.state.settings.shop_name || '';
  const tr = (n, r, cls) => '<tr class="' + (cls || '') + '"><td>' + esc(n) + '</td>' + ['orders', 'plants', 'sales', 'facebook', 'instagram', 'walkin', 'other', 'received', 'outstanding'].map((k) => '<td>' + fmtN(r[k]) + '</td>').join('') + '</tr>';
  $('#print').innerHTML = '<h1>' + esc(shop) + ' — รายงานยอดขายปี ' + repYear + '</h1><p>พิมพ์เมื่อ ' + esc(fmtDate(ctx.store.state.today)) + ' · หน่วย: บาท</p><table><thead><tr><th>เดือน</th><th>ออเดอร์</th><th>ต้นไม้</th><th>ยอดขาย</th><th>Facebook</th><th>Instagram</th><th>หน้าร้าน</th><th>อื่นๆ</th><th>รับเงิน</th><th>ค้างชำระ</th></tr></thead><tbody>' +
    (rep.months || []).map((r, i) => tr(MONTHS[i], r)).join('') + tr('รวม', t, 'tot') + '</tbody></table>';
  setTimeout(() => { window.print(); }, 50);
}

// ---------------------------------------------------------------- settings
const FIELDS = [
  ['ร้าน', [['shop_name', 'ชื่อร้าน (แสดงบนบิล)'], ['contact_email', 'อีเมลติดต่อ']]],
  ['บัญชีธนาคาร (แสดงบนบิล)', [['bank_name', 'ธนาคาร'], ['bank_account_no', 'เลขที่บัญชี'], ['bank_account_name', 'ชื่อบัญชี']]],
  ['บิล', [['invoice_prefix', 'ตัวอักษรนำหน้าเลขบิล'], ['invoice_note', 'ข้อความท้ายบิล']]],
];
export const settingsView = {
  mount(el) {
    const st = ctx.store.state.settings || {};
    el.innerHTML = FIELDS.map((g) => '<div class="card"><div class="h3">' + g[0] + '</div>' + g[1].map((f) => '<label class="fld">' + f[1] + '</label>' + (f[0] === 'invoice_note' ? '<textarea data-k="' + f[0] + '" style="min-height:70px">' + esc(st[f[0]]) + '</textarea>' : '<input data-k="' + f[0] + '" value="' + esc(st[f[0]]) + '" autocomplete="off">')).join('') + '</div>').join('') +
      '<div class="card"><div class="h3">อ่านรูปจดขายด้วย Gemini</div><label class="fld">Gemini API key</label><div class="pwrap"><input data-k="gemini_api_key" id="s-gkey" type="password" value="' + esc(st.gemini_api_key) + '" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="peek" id="s-gshow" type="button">แสดง</button></div>' +
      '<label class="fld">โมเดล</label><input data-k="gemini_model" value="' + esc(st.gemini_model) + '" autocomplete="off" autocapitalize="off">' +
      '<p class="sub" style="margin-top:12px">1. เปิด aistudio.google.com/apikey ด้วยบัญชี Google<br>2. กด Create API key<br>3. คัดลอกมาวางที่ช่องด้านบน แล้วกดบันทึก<br>ใช้ฟรี รูปจะถูกส่งไปให้ Google อ่านเฉพาะตอนกดนำเข้าเท่านั้น</p></div>' +
      bridgeHTML(st) + pushHTML(st) + legacyHTML(st) + purgeHTML() +
      '<button class="btn block" id="s-save">บันทึกการตั้งค่า</button>';
    $('#s-gshow', el).onclick = (e) => { const i = $('#s-gkey', el), sh = i.type === 'password'; i.type = sh ? 'text' : 'password'; e.target.textContent = sh ? 'ซ่อน' : 'แสดง'; };
    $('#s-save', el).onclick = () => {
      const o = {}; el.querySelectorAll('[data-k]').forEach((x) => { o[x.dataset.k] = x.value.trim(); });
      Object.assign(o, readBridge(el));
      ctx.store.saveSettings(o).then(() => { toast('บันทึกการตั้งค่าแล้ว'); ctx.nav.menu(null); }, (e) => toast(errMsg(e), true));
    };
    initBridge(el);
    initPush(el);
  },
  update() {},
};

// ---------------------------------------------------------------- bridge (Google Sheet + Calendar), legacy import, photo purge
const lsGetS = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSetS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
const SHEET_KEY = 'plantapp_sheet_url';
const hourOf = (v) => { const n = Math.round(num(v)); return Math.min(23, Math.max(0, n)); };

function bridgeHTML(st) {
  const hr = st.reminder_hour == null || st.reminder_hour === '' ? 9 : hourOf(st.reminder_hour);
  return '<div class="card" id="s-bridge"><div class="h3">Google Sheet และแจ้งเตือน</div>' +
    '<label class="fld">URL เว็บแอป (Apps Script)</label><input id="b-url" value="' + esc(st.bridge_url) + '" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url">' +
    '<label class="fld">โทเคน</label><div class="pwrap"><input id="b-tok" type="password" value="' + esc(st.bridge_token) + '" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="peek" id="b-show" type="button">แสดง</button></div>' +
    '<label class="switch" style="margin-top:10px"><input type="checkbox" id="b-cal"' + (st.calendar_enabled === false ? '' : ' checked') + '> แจ้งเตือนส่งของใน Google Calendar</label>' +
    '<label class="fld">เวลาแจ้งเตือน (ชั่วโมง 0–23)</label><input id="b-hr" type="number" inputmode="numeric" min="0" max="23" value="' + hr + '">' +
    '<div class="grid2" style="margin-top:14px"><button class="btn sec sm" id="b-test">ทดสอบการเชื่อมต่อ</button><button class="btn sec sm" id="b-all">ซิงค์ทั้งหมดตอนนี้</button></div>' +
    '<a class="btn ghost sm block" id="b-open" target="_blank" rel="noopener" style="margin-top:8px" hidden>เปิด Google Sheet</a>' +
    '<div class="prog" id="b-prog" hidden><i></i></div><div class="bstat" id="b-stat" aria-live="polite"></div>' +
    '<p class="sub" style="margin-top:10px">ออเดอร์ ต้นไม้ และลูกค้าจะถูกส่งไปที่ Google Sheet เองเบื้องหลัง (ไม่ทำให้แอปช้า) และสร้างนัดส่งของใน Google Calendar<br>วิธีตั้งค่า: เปิด Google Sheet → รันฟังก์ชัน setup ใน Apps Script → คัดลอกโทเคนจากแท็บ Bridge และ URL ของเว็บแอปจากหน้า Deploy มาวางที่นี่ → กดทดสอบ → กดบันทึกการตั้งค่า</p></div>';
}
function pushHTML(st) {
  const row = (k, label) => '<div class="pushrow"><label class="switch"><input type="checkbox" id="p-' + k + '-on"' + (st['push_' + k + '_enabled'] === false ? '' : ' checked') + '> ' + label + '</label>' +
    '<input type="time" id="p-' + k + '-t" value="' + esc(st['push_' + k + '_time'] || (k === 'before' ? '18:00' : '08:00')) + '" aria-label="เวลา' + label + '"></div>';
  return '<div class="card" id="s-push"><div class="h3">แจ้งเตือน Push ส่งของ</div>' +
    '<div class="bstat" id="p-stat" style="margin-top:0" aria-live="polite">กำลังตรวจสอบ…</div>' +
    '<label class="fld">Web Push key (VAPID)</label><input data-k="push_vapid_key" id="p-key" value="' + esc(st.push_vapid_key) + '" placeholder="B…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
    row('before', 'เตือนวันก่อนส่ง') + row('day', 'เตือนวันส่ง') +
    '<div class="bstat" id="p-hint" hidden></div>' +
    '<button class="btn sec sm block" id="p-on" type="button" style="margin-top:14px">เปิดการแจ้งเตือนบนเครื่องนี้</button><button class="btn sec sm block" id="p-off" type="button" style="margin-top:14px" hidden>ปิดบนเครื่องนี้</button>' +
    '<button class="btn ghost sm block" id="p-test" type="button" style="margin-top:8px">ส่งแจ้งเตือนทดสอบ</button>' +
    '<p class="sub" style="margin-top:10px">วิธีตั้งค่า (ทำครั้งเดียว)<br>1. Firebase Console → Project settings → Cloud Messaging → Web configuration → Generate key pair แล้วคัดลอกมาวางที่ช่อง Web Push key → กดบันทึกการตั้งค่า<br>2. สร้าง Service Account key (Project settings → Service accounts → Generate new private key) วางลงในแท็บ Bridge ของชีต แล้วรันฟังก์ชัน setupPush<br>3. กลับมาที่นี่ กด "เปิดการแจ้งเตือนบนเครื่องนี้" ในแต่ละเครื่อง แล้วกด "ส่งแจ้งเตือนทดสอบ"<br>iPhone/iPad: ต้องเพิ่มแอปไว้หน้าจอโฮม (แชร์ → เพิ่มลงหน้าจอโฮม) แล้วเปิดจากไอคอนนั้น</p></div>';
}
function legacyHTML(st) {
  return '<div class="card" id="s-legacy" hidden><div class="h3">ย้ายข้อมูลจากระบบเดิม</div>' +
    '<p class="sub" id="l-msg" style="margin-bottom:12px">ดึงต้นไม้ ลูกค้า และออเดอร์จาก Google Sheet ของระบบเดิมเข้ามาในแอปนี้ (เลขที่บิลและรหัสเดิมจะคงไว้ ข้ามรายการที่มีอยู่แล้ว)</p>' +
    '<div id="l-done" class="pill p-mint" style="margin-bottom:12px" hidden>ย้ายแล้ว</div><button class="btn sec block" id="l-go">ดึงข้อมูลจากระบบเดิม</button></div>';
}
function purgeHTML() {
  return '<div class="card" id="s-purge"><div class="h3">ล้างรูปต้นที่ขายไปนานแล้ว</div>' +
    '<p class="sub" style="margin-bottom:12px">ลบรูปขนาดใหญ่ของต้นที่ขายหมดไปนานแล้ว เพื่อประหยัดพื้นที่ — รูปย่อยังอยู่ ออเดอร์ไม่กระทบ</p>' +
    '<div class="seg" id="u-seg"><button class="on" data-m="6">เกิน 6 เดือน</button><button data-m="12">เกิน 12 เดือน</button></div>' +
    '<button class="btn warn block" id="u-go" style="margin-top:12px">' + icon('trash') + ' ล้างรูปต้น</button></div>';
}
function readBridge(el) {
  return { bridge_url: $('#b-url', el).value.trim(), bridge_token: $('#b-tok', el).value.trim(), calendar_enabled: $('#b-cal', el).checked, reminder_hour: hourOf($('#b-hr', el).value) };
}
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);
const hm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }); };

function initBridge(el) {
  const S = ctx.store, B = ctx.bridge, g = (id) => $('#' + id, el);
  g('b-show').onclick = (e) => { const i = g('b-tok'), sh = i.type === 'password'; i.type = sh ? 'text' : 'password'; e.target.textContent = sh ? 'ซ่อน' : 'แสดง'; };
  const saveB = () => S.saveSettings(readBridge(el));
  const typedConfigured = () => !!(g('b-url').value.trim() && g('b-tok').value.trim());
  const showSheet = (u) => { const a = g('b-open'); if (u && /^https:\/\//i.test(u)) { a.href = u; a.hidden = false; } else a.hidden = true; };
  showSheet(lsGetS(SHEET_KEY));

  const drawLegacy = () => {
    const st = S.state.settings || {};
    g('s-legacy').hidden = !typedConfigured();
    g('l-done').hidden = !st.legacy_imported;
    g('l-go').textContent = st.legacy_imported ? 'ดึงข้อมูลจากระบบเดิมอีกครั้ง' : 'ดึงข้อมูลจากระบบเดิม';
  };
  const drawStat = () => {
    const box = g('b-stat');
    if (!B) { box.textContent = 'ฟีเจอร์นี้ยังไม่พร้อมใช้งาน'; return; }
    const s = B.status(), parts = [];
    if (!typedConfigured() && !s.configured) { box.className = 'bstat'; box.textContent = 'ยังไม่ได้เชื่อมต่อ — ใส่ URL และโทเคนด้านบน'; return; }
    parts.push(s.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้บันทึกการตั้งค่า');
    if (s.pending) parts.push('รอซิงค์ ' + s.pending + ' รายการ');
    if (s.busy) parts.push('กำลังซิงค์…');
    if (s.lastOk) parts.push('ซิงค์ล่าสุด ' + hm(s.lastOk));
    if (s.lastError) parts.push('ข้อผิดพลาดล่าสุด: ' + s.lastError);
    box.className = 'bstat' + (s.lastError ? ' bad' : ''); box.textContent = parts.join(' · ');
  };
  drawStat(); drawLegacy();
  if (B) {
    const off = B.onStatus(() => { if (!el.isConnected) { if (off) off(); return; } drawStat(); drawLegacy(); });
  }
  el.addEventListener('input', (e) => { if (e.target.id === 'b-url' || e.target.id === 'b-tok') { drawStat(); drawLegacy(); } });

  g('b-test').onclick = async () => {
    if (!B) return toast('ฟีเจอร์นี้ยังไม่พร้อมใช้งาน', true);
    if (!typedConfigured()) return toast('กรุณาใส่ URL และโทเคนก่อน', true);
    const btn = g('b-test'); btn.disabled = true; btn.textContent = 'กำลังทดสอบ…';
    try {
      await saveB();
      const r = await B.test();
      if (r && r.sheet_url) { lsSetS(SHEET_KEY, r.sheet_url); showSheet(r.sheet_url); }
      toast('เชื่อมต่อสำเร็จ');
    } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false; btn.textContent = 'ทดสอบการเชื่อมต่อ'; drawStat(); drawLegacy();
  };
  g('b-all').onclick = async () => {
    if (!B) return toast('ฟีเจอร์นี้ยังไม่พร้อมใช้งาน', true);
    if (!typedConfigured()) return toast('กรุณาใส่ URL และโทเคนก่อน', true);
    const btn = g('b-all'), prog = g('b-prog'), bar = $('i', prog); btn.disabled = true; prog.hidden = false; bar.style.width = '3%';
    try {
      await saveB();
      const r = await B.pushAll((done, total) => { bar.style.width = Math.max(3, Math.round(100 * done / Math.max(1, total))) + '%'; btn.textContent = 'กำลังซิงค์ ' + done + '/' + total; });
      bar.style.width = '100%';
      toast('ซิงค์แล้ว: ออเดอร์ ' + ((r && r.orders) || 0) + ' · ต้นไม้ ' + ((r && r.plants) || 0) + ' · ลูกค้า ' + ((r && r.customers) || 0));
    } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false; btn.textContent = 'ซิงค์ทั้งหมดตอนนี้'; setTimeout(() => { prog.hidden = true; }, 800); drawStat();
  };

  g('l-go').onclick = async () => {
    if (!B) return toast('ฟีเจอร์นี้ยังไม่พร้อมใช้งาน', true);
    const btn = g('l-go'); btn.disabled = true; btn.textContent = 'กำลังดึงข้อมูล…';
    let data = null;
    try { await saveB(); data = await B.fetchLegacy(); } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false; drawLegacy();
    if (!data) return;
    const n = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
    dialog('ย้ายข้อมูลจากระบบเดิม?', '<p>พบข้อมูลในระบบเดิม</p><div class="card flat"><div class="kv"><span>ต้นไม้</span><b>' + n('plants') + '</b></div><div class="kv"><span>ลูกค้า</span><b>' + n('customers') + '</b></div><div class="kv"><span>ออเดอร์</span><b>' + n('orders') + '</b></div></div><p class="sub">รายการที่มีรหัสซ้ำกับที่มีในแอปแล้วจะถูกข้าม จึงกดซ้ำได้อย่างปลอดภัย</p>', 'ย้ายข้อมูล', () => {
      const end = busy('กำลังย้ายข้อมูล…');
      return (async () => {
        try {
          const existing = await S.exportAll();
          const r = await S.importLegacy(data, { existing });
          toast('ย้ายแล้ว: ต้นไม้ ' + r.plants + ' · ลูกค้า ' + r.customers + ' · ออเดอร์ ' + r.orders + (r.skipped ? ' · ข้าม ' + r.skipped : ''));
          drawLegacy();
        } catch (er) { toast(errMsg(er), true); return false; } finally { end(); }
      })();
    });
  };

  let months = 6;
  g('u-seg').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; months = +b.dataset.m; g('u-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  g('u-go').onclick = () => confirmDlg('ล้างรูปต้นที่ขายเกิน ' + months + ' เดือน?', 'รูปใหญ่ของต้นที่ขายหมดเกิน ' + months + ' เดือนจะถูกลบถาวร (รูปย่อยยังอยู่) ย้อนกลับไม่ได้', 'ล้างรูป', () => {
    const end = busy('กำลังล้างรูป…');
    return S.purgeOldPhotos(months).then((n) => { toast(n ? 'ล้างรูปแล้ว ' + n + ' ต้น' : 'ไม่มีรูปที่เข้าเงื่อนไข'); }, (er) => { toast(errMsg(er), true); return false; }).finally(end);
  });
}

// ---------------------------------------------------------------- push notifications (SPEC5)
const PUSH_LS = 'plantapp_push_token';
function initPush(el) {
  const S = ctx.store, g = (id) => $('#' + id, el);
  let pm = null;
  // preload so Notification.requestPermission() can be the first call inside the tap (iOS gesture rule)
  if (!ctx.demo) import('./push.js').then((m) => { pm = m; if (el.isConnected) draw(); }).catch(() => { if (el.isConnected) draw(); });
  let sup = null;
  const bridgeOn = () => !!(ctx.bridge && ctx.bridge.status().configured);
  const cfgBody = () => ({ before_enabled: g('p-before-on').checked, before_time: hhmm(g('p-before-t').value, '18:00'), day_enabled: g('p-day-on').checked, day_time: hhmm(g('p-day-t').value, '08:00') });
  const hint = (t, bad) => { const h = g('p-hint'); h.hidden = !t; h.textContent = t || ''; h.className = 'bstat' + (bad ? ' bad' : ''); };
  function draw() {
    const on = !!lsGetS(PUSH_LS) && !ctx.demo, stat = g('p-stat');
    let t = '', bad = false;
    if (ctx.demo) t = 'โหมดตัวอย่าง — การแจ้งเตือนใช้ได้เฉพาะในแอปจริง';
    else if (!sup) t = 'กำลังตรวจสอบ…';
    else if (sup.reason === 'ios-not-installed') { t = 'ต้องเปิดแอปจากไอคอนบนหน้าจอโฮมก่อน (iPhone/iPad)'; bad = true; }
    else if (sup.reason === 'unsupported') { t = 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน'; bad = true; }
    else if (sup.reason === 'denied') { t = 'ถูกปิดสิทธิ์ในตั้งค่าเครื่อง — เปิดสิทธิ์แจ้งเตือนของแอปนี้ในตั้งค่าเครื่องก่อน'; bad = true; }
    else t = 'เครื่องนี้รองรับการแจ้งเตือน';
    if (on && sup && sup.supported) t += ' · เครื่องนี้เปิดแจ้งเตือนแล้ว';
    stat.className = 'bstat' + (bad ? ' bad' : ''); stat.textContent = t;
    g('p-on').hidden = on; g('p-off').hidden = !on;
    if (!ctx.demo && !bridgeOn() && !(g('p-hint').dataset.k === 'cfg')) { hint('ต้องตั้งค่า Google Sheet ในส่วนด้านบนก่อน (URL เว็บแอปและโทเคน แล้วกดบันทึก) ถึงจะใช้แจ้งเตือนได้', false); }
    else if (bridgeOn() && g('p-hint').dataset.k !== 'cfg') hint('');
  }
  if (ctx.demo) { draw(); } else { draw(); import('./push.js').then((m) => m.pushSupport()).then((r) => { sup = r; if (el.isConnected) draw(); }, () => { sup = { supported: false, reason: 'unsupported' }; if (el.isConnected) draw(); }); }

  const noBridge = () => { if (bridgeOn()) return false; toast('ต้องตั้งค่า Google Sheet ก่อน (ส่วนด้านบน)', true); return true; };
  const sendCfg = async () => {
    const h = g('p-hint'); h.dataset.k = '';
    if (ctx.demo || !bridgeOn()) return;
    try {
      const r = await ctx.bridge.pushConfig(cfgBody());
      if (r && r.ready === false) { h.dataset.k = 'cfg'; hint('ยังไม่ได้รันฟังก์ชัน setupPush ในชีต — ตั้งเวลาไว้แล้ว แต่ยังไม่ส่งแจ้งเตือนจนกว่าจะรัน', true); }
      else { hint(''); }
    } catch (er) { toast(errMsg(er), true); }
  };
  const saveTimes = () => {
    const b = cfgBody();
    S.saveSettings({ push_before_enabled: b.before_enabled, push_before_time: b.before_time, push_day_enabled: b.day_enabled, push_day_time: b.day_time }).then(sendCfg, (er) => toast(errMsg(er), true));
  };
  ['p-before-on', 'p-before-t', 'p-day-on', 'p-day-t'].forEach((id) => { g(id).addEventListener('change', saveTimes); });

  g('p-on').onclick = () => {
    if (ctx.demo) return toast('ต้องใช้แอปจริง (ไม่ใช่โหมดตัวอย่าง) ถึงจะเปิดแจ้งเตือนได้', true);
    if (noBridge()) return;
    const key = g('p-key').value.trim(), btn = g('p-on');
    // NOTE: enablePush() calls Notification.requestPermission() synchronously — keep it first in this handler
    const run = pm ? pm.enablePush({ vapidKey: key }) : import('./push.js').then((m) => { pm = m; return m.enablePush({ vapidKey: key }); });
    btn.disabled = true; btn.textContent = 'กำลังเปิด…';
    (async () => {
      try {
        const token = await run;
        await S.saveSettings({ push_vapid_key: key });
        await ctx.bridge.pushRegister(token, pm.deviceLabel());
        toast('เปิดแจ้งเตือนบนเครื่องนี้แล้ว');
        sendCfg();
      } catch (er) { toast(errMsg(er), true); }
      btn.disabled = false; btn.textContent = 'เปิดการแจ้งเตือนบนเครื่องนี้';
      try { if (pm) sup = await pm.pushSupport(); } catch (e) { /* ignore */ }
      if (el.isConnected) draw();
    })();
  };
  g('p-off').onclick = async () => {
    const btn = g('p-off'); btn.disabled = true;
    try {
      const m = pm || await import('./push.js'), tok = m.getSavedToken();
      await m.disablePush();
      if (tok && bridgeOn()) { try { await ctx.bridge.pushUnregister(tok); } catch (er) { toast(errMsg(er), true); } }
      toast('ปิดแจ้งเตือนบนเครื่องนี้แล้ว');
    } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false; if (el.isConnected) draw();
  };
  g('p-test').onclick = async () => {
    if (ctx.demo) return toast('ต้องใช้แอปจริง (ไม่ใช่โหมดตัวอย่าง) ถึงจะทดสอบได้', true);
    if (noBridge()) return;
    const btn = g('p-test'); btn.disabled = true; btn.textContent = 'กำลังส่ง…';
    try {
      const r = await ctx.bridge.pushTest();
      const n = (r && r.sent) || 0, f = (r && r.failed) || 0;
      if (!n && !f) toast('ยังไม่มีเครื่องที่ลงทะเบียน — กด "เปิดการแจ้งเตือนบนเครื่องนี้" ก่อน', true);
      else toast('ส่งแล้ว ' + n + ' เครื่อง' + (f ? ' · ไม่สำเร็จ ' + f + (r.errors && r.errors[0] ? ' (' + r.errors[0] + ')' : '') : ''), !!f && !n);
    } catch (er) { toast(errMsg(er), true); }
    btn.disabled = false; btn.textContent = 'ส่งแจ้งเตือนทดสอบ';
  };
  const bo = ctx.bridge && ctx.bridge.onStatus(() => { if (!el.isConnected) { if (bo) bo(); return; } draw(); });
}
