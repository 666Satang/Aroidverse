// Reports screen (SPEC8): daily / monthly tables with cost + profit, CSV + print.
import { ctx, $, esc, num, str, sum, money, fmtN, fmtDate, MON, MONTHS, icon, toast, openSheet, bind, errMsg, emptyHTML, shareOrDownload, negCls, hasNum } from './ui-core.js';
import { orderCard, openOrder } from './ui-orders.js';

let mode = 'month', repYear = null, repYm = null;
let rep = null, drep = null, loading = false, tok = 0;
const COLS = ['orders', 'plants', 'sales', 'facebook', 'instagram', 'walkin', 'other', 'received', 'outstanding', 'cancelled'];
const n = (v) => (hasNum(v) ? Number(v) : 0);
// "ต้นทุน" in the tables = plants cost + shipping paid, so sales − cost = gross profit
const costOf = (r) => n(r.cogs) + n(r.shipping_cost);
const ymAdd = (ym, d) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };
const ymLabel = (ym) => MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
const cell = (v) => '<td class="' + (n(v) ? '' : 'z') + negCls(v).trim() + '">' + fmtN(v) + '</td>';

function table(head, rows, tot, attr) {
  return '<div class="rtw"><table class="rt rt-w"><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + (tot || '') + '</tbody></table></div>';
}

export const reportsView = {
  mount(el) {
    const S = ctx.store, cur = S.state.today.slice(0, 4), curYm = S.state.today.slice(0, 7);
    if (repYear == null) repYear = +cur;
    if (repYm == null) repYm = curYm;
    el.innerHTML = '<div class="seg" id="r-mode"><button data-act="mode" data-m="day">รายวัน</button><button data-act="mode" data-m="month">รายเดือน</button></div>' +
      '<div class="yr" id="r-nav" style="margin-top:12px"><button data-act="prev" aria-label="ก่อนหน้า">' + icon('left') + '</button><b id="r-y"></b><button data-act="next" aria-label="ถัดไป">' + icon('right') + '</button><button data-act="rf" aria-label="โหลดใหม่" style="margin-left:6px">' + icon('refresh') + '</button></div><div id="r-body"></div>';
    const load = async (refresh) => {
      const my = ++tok; loading = true;
      if (mode === 'month') rep = null; else drep = null;
      this.update(el);
      try {
        if (mode === 'month') { const r = await S.monthlyReport(repYear, { refresh: !!refresh }); if (my === tok) rep = r; }
        else { const r = await S.dailyReport(repYm, { refresh: !!refresh }); if (my === tok) drep = r; }
      } catch (e) { if (my === tok) toast(errMsg(e), true); }
      if (my === tok) { loading = false; this.update(el); }
    };
    bind(el, {
      mode: (d) => { if (d.m === mode) return; mode = d.m; load(); },
      prev: () => { if (mode === 'month') repYear--; else repYm = ymAdd(repYm, -1); load(); },
      next: () => { if (mode === 'month') { if (repYear < +cur) { repYear++; load(); } } else if (repYm < curYm) { repYm = ymAdd(repYm, 1); load(); } },
      rf: () => load(true),
      month: (d) => { repYm = repYear + '-' + String(+d.m).padStart(2, '0'); mode = 'day'; load(); },
      day: (d) => openDay(d.d),
      exp: () => ctx.nav.menu('expenses', repYm),
      csv: doCsv, print: doPrint,
    });
    load();
  },
  update(el) {
    const S = ctx.store, cur = S.state.today.slice(0, 4), curYm = S.state.today.slice(0, 7);
    $('#r-mode', el).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    $('#r-y', el).textContent = mode === 'month' ? 'ปี ' + repYear : ymLabel(repYm);
    $('[data-act="next"]', el).disabled = mode === 'month' ? repYear >= +cur : repYm >= curYm;
    const b = $('#r-body', el), data = mode === 'month' ? rep : drep;
    if (loading || !data) { b.innerHTML = '<div class="more" style="padding:40px"><span class="spin"></span></div>'; return; }
    b.innerHTML = mode === 'month' ? monthHTML(data) : dayHTML(data);
  },
};

const warnHTML = (m) => (n(m) > 0 ? '<div class="warnbox" style="margin-top:14px">' + icon('alert') + '<span>กำไรอาจสูงเกินจริง: มี ' + n(m) + ' รายการยังไม่ได้ใส่ต้นทุน</span></div>' : '');
const actionsHTML = '<div class="grid2" style="margin-top:16px"><button class="btn sec" data-act="csv">' + icon('table') + ' ส่งออก CSV</button><button class="btn sec" data-act="print">' + icon('print') + ' พิมพ์ / PDF</button></div>';
const statCard = (cls, t, v, s, wide) => '<div class="stat-c ' + cls + (wide ? ' wide' : '') + '"><div class="t"><i></i>' + t + '</div><div class="v' + negCls(v).trim() + '" style="' + (wide ? '' : 'font-size:22px') + '">' + esc(money(v)) + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';

function monthHTML(r) {
  const t = r.total || {}, m = r.months || [];
  const row = (name, x, i, tot) => '<tr' + (tot ? ' class="tot"' : ' data-act="month" data-m="' + (i + 1) + '"') + '><td>' + name + '</td>' + cell(x.orders) + cell(x.sales) + cell(costOf(x)) + cell(x.gross_profit) + cell(x.expenses) + cell(x.net_profit) + '</tr>';
  return '<div class="stats" style="margin-top:16px">' + statCard('mint', 'ยอดขายปี ' + repYear, t.sales, (t.orders || 0) + ' ออเดอร์ · ต้นไม้ ' + (t.plants || 0) + ' ต้น', true) +
    statCard('sky', 'รับเงินแล้ว', t.received) + statCard('peach', 'ค้างชำระ', t.outstanding) +
    statCard('mint', 'กำไรขั้นต้น', t.gross_profit) + statCard('peach', 'กำไรสุทธิ', t.net_profit) + '</div>' + warnHTML(t.cost_missing) +
    '<div class="card rcard">' + table(['เดือน', 'ออเดอร์', 'ยอดขาย', 'ต้นทุน', 'กำไรขั้นต้น', 'ค่าใช้จ่าย', 'กำไรสุทธิ'], m.map((x, i) => row(MON[i], x, i)), row('รวม', t, 0, true)) + '</div>' +
    '<div class="sub" style="margin:8px 4px 0">หน่วย: บาท · ต้นทุน = ต้นไม้ + ค่าส่งที่ร้านจ่ายจริง · กำไรสุทธิ = กำไรขั้นต้น − ค่าใช้จ่าย · แตะเดือนเพื่อดูรายวัน</div>' + actionsHTML;
}
function dayHTML(r) {
  const t = r.total || {}, days = r.days || [], isCur = repYm === ctx.store.state.today.slice(0, 7);
  const row = (label, x, d, tot) => '<tr' + (tot ? ' class="tot"' : ' data-act="day" data-d="' + esc(d) + '"') + '><td>' + label + '</td>' + cell(x.orders) + cell(x.sales) + cell(costOf(x)) + cell(x.gross_profit) + cell(x.received) + '</tr>';
  const body = days.length ? table(['วันที่', 'ออเดอร์', 'ยอดขาย', 'ต้นทุน', 'กำไร', 'รับเงิน'], days.map((x) => row(esc(fmtDate(x.date, true)), x, x.date)), row('รวม', t, '', true)) : '';
  return '<div class="stats" style="margin-top:16px">' + statCard('mint', 'ยอดขาย', t.sales, (t.orders || 0) + ' ออเดอร์') + statCard('peach', 'กำไรสุทธิ', r.net_profit) + '</div>' + warnHTML(t.cost_missing) +
    (days.length ? '<div class="card rcard">' + body + '</div>' : '<div class="card flat sub" style="text-align:center;padding:24px;margin-top:14px">ไม่มีออเดอร์ในเดือนนี้</div>') +
    '<div class="card" style="margin-top:14px"><button class="kv expline" data-act="exp" style="width:100%"><span>' + (isCur ? 'ค่าใช้จ่ายเดือนนี้' : 'ค่าใช้จ่ายเดือน' + esc(MONTHS[+repYm.slice(5, 7) - 1])) + ' ' + icon('chev', 'chev sm') + '</span><b class="' + (n(r.expenses) ? 'red' : '') + '">' + (n(r.expenses) ? '-' : '') + esc(money(r.expenses)) + '</b></button>' +
    '<div class="kv hl"><span>กำไรสุทธิ</span><span class="' + (n(r.net_profit) < 0 ? 'red' : 'green') + '">' + esc(money(r.net_profit)) + '</span></div></div>' +
    '<div class="sub" style="margin:8px 4px 0">หน่วย: บาท · ต้นทุน = ต้นไม้ + ค่าส่งที่ร้านจ่ายจริง · แตะวันที่เพื่อดูออเดอร์ของวันนั้น</div>' + actionsHTML;
}

function openDay(date) {
  const row = ((drep && drep.days) || []).find((d) => d.date === date) || {};
  const s = openSheet({ title: fmtDate(date), live: false, build(sh) { sh.body.innerHTML = '<div class="more" style="padding:40px"><span class="spin"></span></div>'; } });
  ctx.store.loadMonth(date.slice(0, 7)).then((os) => {
    if (s.closed) return;
    os = (os || []).filter((o) => str(o.order_date) === date).sort((a, b) => (str(a.code) < str(b.code) ? 1 : -1));
    os.forEach((o) => ctx.extra.set(o.id, o));
    s.body.innerHTML = os.length ? '<div class="card"><div class="kv"><span>ออเดอร์ (ไม่รวมยกเลิก)</span><b>' + n(row.orders) + '</b></div><div class="kv"><span>ยอดขาย</span><b>' + esc(money(row.sales)) + '</b></div><div class="kv"><span>ต้นทุน (ต้นไม้ + ค่าส่ง)</span><b>' + esc(money(costOf(row))) + '</b></div><div class="kv hl"><span>กำไร</span><span class="' + (n(row.gross_profit) < 0 ? 'red' : 'green') + '">' + esc(money(row.gross_profit)) + '</span></div></div><div class="list" style="margin-top:14px">' + os.map(orderCard).join('') + '</div>' : emptyHTML('🗓️', 'ไม่มีออเดอร์ในวันนี้', '', '', '');
    bind(s.body, { order: (d) => openOrder(d.id) });
  }, (e) => { if (!s.closed) s.body.innerHTML = '<div class="empty"><div class="t">โหลดไม่สำเร็จ</div><p>' + esc(errMsg(e)) + '</p></div>'; });
}

// ---------------------------------------------------------------- CSV + print
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function monthCsv(r) {
  const head = ['เดือน', 'ออเดอร์', 'ต้นไม้ (ต้น)', 'ยอดขาย', 'Facebook', 'Instagram', 'หน้าร้าน', 'อื่นๆ', 'รับเงิน', 'ค้างชำระ', 'ยกเลิก', 'ต้นทุนต้นไม้', 'ค่าส่งที่จ่ายจริง', 'ต้นทุนรวม', 'กำไรขั้นต้น', 'ค่าใช้จ่าย', 'กำไรสุทธิ', 'รายการที่ยังไม่มีต้นทุน'];
  const line = (name, x) => [name].concat(COLS.map((k) => n(x[k])), [n(x.cogs), n(x.shipping_cost), costOf(x), n(x.gross_profit), n(x.expenses), n(x.net_profit), n(x.cost_missing)]).map(csvCell).join(',');
  return [head.map(csvCell).join(',')].concat((r.months || []).map((x, i) => line(MONTHS[i], x)), [line('รวม', r.total || {})]).join('\r\n');
}
export function dayCsv(r) {
  const head = ['วันที่', 'ออเดอร์', 'ต้นไม้ (ต้น)', 'ยอดขาย', 'ต้นทุนต้นไม้', 'ค่าส่งที่จ่ายจริง', 'ต้นทุนรวม', 'กำไร', 'รับเงิน', 'รายการที่ยังไม่มีต้นทุน'];
  const line = (name, x) => [name, n(x.orders), n(x.plants), n(x.sales), n(x.cogs), n(x.shipping_cost), costOf(x), n(x.gross_profit), n(x.received), n(x.cost_missing)].map(csvCell).join(',');
  const t = r.total || {}, pad = (a, b) => [a, '', '', '', '', '', '', b].map(csvCell).join(',');
  return [head.map(csvCell).join(',')].concat((r.days || []).map((x) => line(x.date, x)), [line('รวม', t), pad('ค่าใช้จ่ายเดือนนี้', n(r.expenses)), pad('กำไรสุทธิ', n(r.net_profit))]).join('\r\n');
}
async function doCsv() {
  const r = mode === 'month' ? rep : drep; if (!r) return;
  const blob = new Blob(['﻿' + (mode === 'month' ? monthCsv(r) : dayCsv(r))], { type: 'text/csv;charset=utf-8' });
  const res = await shareOrDownload(blob, (mode === 'month' ? 'sales-report-' + repYear : 'sales-daily-' + repYm) + '.csv', 'text/csv');
  if (res !== 'cancel') toast(res === 'shared' ? 'ส่งไฟล์ CSV แล้ว' : 'ดาวน์โหลด CSV แล้ว');
}
function doPrint() {
  const r = mode === 'month' ? rep : drep; if (!r) return;
  const shop = ctx.store.state.settings.shop_name || '', t = r.total || {};
  const cellP = (v) => '<td class="' + negCls(v).trim() + '">' + fmtN(v) + '</td>';
  let h;
  if (mode === 'month') {
    const tr = (nm, x, cls) => '<tr class="' + (cls || '') + '"><td>' + esc(nm) + '</td>' + ['orders', 'plants', 'sales', 'facebook', 'instagram', 'walkin', 'other', 'received', 'outstanding'].map((k) => cellP(x[k])).join('') + cellP(costOf(x)) + cellP(x.gross_profit) + cellP(x.expenses) + cellP(x.net_profit) + '</tr>';
    h = '<h1>' + esc(shop) + ' — รายงานยอดขายปี ' + repYear + '</h1><p>พิมพ์เมื่อ ' + esc(fmtDate(ctx.store.state.today)) + ' · หน่วย: บาท · ต้นทุน = ต้นไม้ + ค่าส่งที่ร้านจ่ายจริง</p><table><thead><tr><th>เดือน</th><th>ออเดอร์</th><th>ต้นไม้</th><th>ยอดขาย</th><th>Facebook</th><th>Instagram</th><th>หน้าร้าน</th><th>อื่นๆ</th><th>รับเงิน</th><th>ค้างชำระ</th><th>ต้นทุน</th><th>กำไรขั้นต้น</th><th>ค่าใช้จ่าย</th><th>กำไรสุทธิ</th></tr></thead><tbody>' +
      (r.months || []).map((x, i) => tr(MONTHS[i], x)).join('') + tr('รวม', t, 'tot') + '</tbody></table>' + (n(t.cost_missing) ? '<p>* กำไรอาจสูงเกินจริง: มี ' + n(t.cost_missing) + ' รายการยังไม่ได้ใส่ต้นทุน</p>' : '');
  } else {
    const tr = (nm, x, cls) => '<tr class="' + (cls || '') + '"><td>' + esc(nm) + '</td>' + cellP(x.orders) + cellP(x.plants) + cellP(x.sales) + cellP(costOf(x)) + cellP(x.gross_profit) + cellP(x.received) + '</tr>';
    h = '<h1>' + esc(shop) + ' — รายงานรายวัน ' + esc(ymLabel(repYm)) + '</h1><p>พิมพ์เมื่อ ' + esc(fmtDate(ctx.store.state.today)) + ' · หน่วย: บาท · ต้นทุน = ต้นไม้ + ค่าส่งที่ร้านจ่ายจริง</p><table><thead><tr><th>วันที่</th><th>ออเดอร์</th><th>ต้นไม้</th><th>ยอดขาย</th><th>ต้นทุน</th><th>กำไร</th><th>รับเงิน</th></tr></thead><tbody>' +
      (r.days || []).map((x) => tr(fmtDate(x.date), x)).join('') + tr('รวม', t, 'tot') + '</tbody></table>' +
      '<p>ค่าใช้จ่ายเดือนนี้: ' + esc(money(r.expenses)) + ' · กำไรสุทธิ: ' + esc(money(r.net_profit)) + '</p>' + (n(t.cost_missing) ? '<p>* กำไรอาจสูงเกินจริง: มี ' + n(t.cost_missing) + ' รายการยังไม่ได้ใส่ต้นทุน</p>' : '');
  }
  $('#print').innerHTML = h;
  setTimeout(() => { window.print(); }, 50);
}
