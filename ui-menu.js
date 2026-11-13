// Menu tab, reports (CSV + print), settings, backup.
import { ctx, $, esc, num, str, sum, money, fmtN, fmtDate, MON, MONTHS, icon, toast, openSheet, dialog, bind, errMsg, busy, emptyHTML, shareOrDownload, downloadBlob, closeAllSheets } from './ui-core.js';
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
      '<button class="btn block" id="s-save">บันทึกการตั้งค่า</button>';
    $('#s-gshow', el).onclick = (e) => { const i = $('#s-gkey', el), sh = i.type === 'password'; i.type = sh ? 'text' : 'password'; e.target.textContent = sh ? 'ซ่อน' : 'แสดง'; };
    $('#s-save', el).onclick = () => {
      const o = {}; el.querySelectorAll('[data-k]').forEach((x) => { o[x.dataset.k] = x.value.trim(); });
      ctx.store.saveSettings(o).then(() => { toast('บันทึกการตั้งค่าแล้ว'); ctx.nav.menu(null); }, (e) => toast(errMsg(e), true));
    };
  },
  update() {},
};
