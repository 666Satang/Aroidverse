// Orders tab, order detail sheet, payment / ship / edit dialogs, invoice preview.
import { ctx, $, esc, num, str, money, fmtDate, icon, chIcon, toast, openSheet, dialog, confirmDlg, bind, debounce, CH, errMsg, orderPills, isActive, isOver, balanceOf, findOrder, emptyHTML, moreBtn, today, depositOnly, pill, canShareFile, downloadBlob, shareOrDownload, busy, closeAllSheets } from './ui-core.js';

export const FLT = {
  all: () => true,
  unpaid: (o) => isActive(o) && o.payment_status !== 'paid',
  pending: (o) => isActive(o) && o.ship_status === 'pending',
  shipped: (o) => isActive(o) && o.ship_status === 'shipped',
  cancelled: (o) => !isActive(o),
  today: (o) => isActive(o) && o.ship_status === 'pending' && str(o.ship_date) === today(),
  over: (o) => isOver(o),
  month: (o) => isActive(o) && str(o.order_date).slice(0, 7) === today().slice(0, 7),
};
const BASE = [['all', 'ทั้งหมด'], ['unpaid', 'รอจ่าย'], ['pending', 'รอส่ง'], ['shipped', 'ส่งแล้ว'], ['cancelled', 'ยกเลิก']];
const EXTRA = { today: 'ส่งวันนี้', over: 'เลยกำหนดส่ง', month: 'ขายเดือนนี้' };

export function itemsSummary(o) {
  if (str(o.items_summary)) return o.items_summary;
  return (o.items || []).map((i) => i.name + ' ×' + i.qty).join(', ');
}
export function orderCard(o) {
  const bal = balanceOf(o), act = isActive(o);
  let due = '';
  if (act) {
    const parts = [];
    if (bal > 0.005) parts.push('ค้าง ' + money(bal));
    else if (bal < -0.005) parts.push('คืน ' + money(-bal));
    if (o.ship_status === 'pending' && str(o.ship_date)) parts.push('ส่ง ' + fmtDate(o.ship_date, true));
    due = parts.join(' · ');
  }
  return '<button class="ocard' + (act ? '' : ' dim') + '" data-act="order" data-id="' + esc(o.id) + '">' +
    '<div class="l1"><span class="ava ' + esc(o.channel) + '">' + chIcon(o.channel) + '</span><div class="grow"><div class="nm trunc">' + esc(o.customer_name) + '</div><div class="meta trunc">' + esc(o.invoice_no || o.code) + ' · ' + esc(fmtDate(o.order_date, true)) + '</div></div><div class="amt">' + money(o.total) + '</div></div>' +
    '<div class="items clamp2">' + esc(itemsSummary(o)) + '</div>' +
    '<div class="l3">' + orderPills(o) + (due ? '<span class="due">' + esc(due) + '</span>' : '') + '</div></button>';
}

// ---------------------------------------------------------------- tab
export const ordersView = {
  mount(el) {
    const ui = ctx.ui;
    el.innerHTML = '<div class="search"><span>' + icon('search') + '</span><input id="osearch" type="search" placeholder="ค้นหาลูกค้า เลขบิล หรือชื่อต้นไม้" value="' + esc(ui.oq) + '" autocomplete="off" enterkeyhint="search"></div><div class="chips" id="ochips"></div><div class="list" id="olist"></div>';
    const upd = () => this.update(el);
    $('#osearch', el).addEventListener('input', debounce((e) => { ui.oq = e.target.value; ui.limO = 60; upd(); }, 200));
    bind(el, {
      of: (d) => { ui.of = d.f; ui.limO = 60; upd(); },
      order: (d) => openOrder(d.id),
      more: () => { ui.limO += 60; upd(); },
      older: async (d, t) => { t.disabled = true; t.innerHTML = '<span class="spin sm"></span> กำลังโหลด…'; try { await ctx.store.loadMoreOrders(); } catch (e) { toast(errMsg(e), true); } upd(); },
      new: () => import('./ui-form.js').then((m) => m.openOrderForm()),
    });
    this.update(el);
  },
  update(el) {
    const ui = ctx.ui, st = ctx.store.state;
    const q = ui.oq.trim().toLowerCase();
    $('#ochips', el).innerHTML = (EXTRA[ui.of] ? '<button class="chip on" data-act="of" data-f="all">' + esc(EXTRA[ui.of]) + ' ' + icon('close').replace('class="i"', 'class="i" style="width:14px;height:14px"') + '</button>' : '') +
      BASE.map((c) => '<button class="chip' + (ui.of === c[0] ? ' on' : '') + '" data-act="of" data-f="' + c[0] + '">' + c[1] + '</button>').join('');
    const fl = FLT[ui.of] || FLT.all;
    const l = st.orders.filter(fl).filter((o) => !q || (str(o.customer_name) + ' ' + str(o.invoice_no) + ' ' + str(o.items_summary) + ' ' + str(o.code)).toLowerCase().includes(q));
    let h = '';
    if (!l.length) {
      h = !st.orders.length ? emptyHTML('🌱', 'ยังไม่มีออเดอร์', 'กดปุ่ม + ด้านล่างได้เลย หรือสร้างออเดอร์แรกตรงนี้', 'ออเดอร์ใหม่', 'new')
        : emptyHTML('🔍', 'ไม่พบออเดอร์', q ? 'ลองค้นหาด้วยคำอื่น หรือโหลดออเดอร์เก่ากว่านี้' : 'ยังไม่มีออเดอร์ในหมวดนี้', '', '');
    } else {
      h = l.slice(0, ui.limO).map(orderCard).join('');
      if (l.length > ui.limO) h += moreBtn('more');
    }
    if (st.hasMoreOrders) h += '<div class="more"><button class="btn ghost sm" data-act="older">โหลดออเดอร์เก่ากว่านี้</button></div>';
    $('#olist', el).innerHTML = h;
  },
};

// ---------------------------------------------------------------- detail
const PT = { deposit: ['lilac', 'มัดจำ'], payment: ['mint', 'ชำระ'], refund: ['rose', 'คืนเงิน'] };

export function openOrder(id) {
  const S = ctx.store;
  if (!findOrder(id)) return;
  openSheet({
    title: 'ออเดอร์', live: true,
    build(s) {
      const o = findOrder(id);
      if (!o) { s.close(); return; }
      const act = isActive(o), bal = balanceOf(o), over = bal < -0.005;
      s.setTitle(o.invoice_no || o.code || 'ออเดอร์');
      const cu = S.getCustomer(o.customer_id);
      const rows = (o.items || []).map((i) => '<div class="kv"><span>' + esc(i.name) + '<br><span class="sub">' + num(i.qty) + ' × ' + money(i.unit_price) + '</span></span><b>' + money(num(i.unit_price) * num(i.qty)) + '</b></div>').join('');
      const pays = (o.payments || []).map((p) => {
        const t = PT[p.type] || PT.payment;
        return '<div class="pay"><div class="grow"><div>' + pill(t[0], t[1]) + ' <span class="d">' + esc(fmtDate(p.date)) + (p.note ? ' · ' + esc(p.note) : '') + '</span></div></div><div class="a ' + (num(p.amount) < 0 ? 'red' : '') + '">' + money(p.amount) + '</div><button class="xbtn" data-act="delpay" data-id="' + esc(p.id) + '" aria-label="ลบรายการรับเงิน">' + icon('trash') + '</button></div>';
      }).join('');
      let ship = '';
      if (o.ship_status === 'shipped') ship = '<div class="kv"><span>ส่งแล้วเมื่อ</span><b>' + esc(fmtDate(o.shipped_date)) + '</b></div>' + (o.tracking_no ? '<div class="kv"><span>เลขพัสดุ</span><b>' + esc(o.tracking_no) + '</b></div>' : '');
      else ship = '<div class="kv"><span>กำหนดส่ง</span><b class="' + (isOver(o) ? 'red' : '') + '">' + (o.ship_date ? esc(fmtDate(o.ship_date)) : 'ยังไม่กำหนด') + '</b></div>' + (o.tracking_no ? '<div class="kv"><span>เลขพัสดุ</span><b>' + esc(o.tracking_no) + '</b></div>' : '');
      s.body.innerHTML =
        '<div class="card"><div class="row"><span class="ava ' + esc(o.channel) + '">' + chIcon(o.channel) + '</span><div class="grow"><div class="nm" style="font-weight:700;font-size:18px;line-height:1.35">' + esc(o.customer_name) + '</div><div class="sub">' + esc(CH[o.channel] || '') + ' · สั่งเมื่อ ' + esc(fmtDate(o.order_date)) + '</div></div></div>' +
        '<div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px">' + orderPills(o) + '</div>' +
        (cu && cu.address && act && o.ship_status === 'pending' ? '<div class="sub" style="margin-top:12px;display:flex;gap:8px">' + icon('pin') + '<span style="white-space:pre-wrap;word-break:break-word">' + esc(cu.address) + '</span></div>' : '') + '</div>' +
        '<div class="card"><div class="h3">รายการ</div>' + rows + '<div class="hr"></div>' +
        '<div class="kv mut"><span>รวมสินค้า</span><span>' + money(o.subtotal) + '</span></div>' +
        (num(o.shipping_fee) ? '<div class="kv mut"><span>ค่าส่ง</span><span>' + money(o.shipping_fee) + '</span></div>' : '') +
        (num(o.discount) ? '<div class="kv mut"><span>ส่วนลด</span><span>-' + money(o.discount) + '</span></div>' : '') +
        '<div class="kv tot"><span>ยอดรวม</span><span>' + money(o.total) + '</span></div></div>' +
        '<div class="card"><div class="h3">การชำระเงิน</div>' + (pays || '<div class="sub" style="padding:2px 0 6px">ยังไม่มีรายการรับเงิน</div>') +
        '<div class="hr"></div>' +
        (num(o.deposit_amount) ? '<div class="kv mut"><span>มัดจำแล้ว</span><span>' + money(o.deposit_amount) + '</span></div>' : '') +
        '<div class="kv mut"><span>จ่ายแล้วรวม</span><span>' + money(o.paid_amount) + '</span></div>' +
        '<div class="kv hl"><span>' + (over ? 'ต้องคืนเงิน' : 'ค้างชำระ') + '</span><span class="' + (over ? 'red' : bal > 0.005 ? '' : 'green') + '">' + money(Math.abs(bal) < 0.005 ? 0 : Math.abs(bal)) + '</span></div></div>' +
        '<div class="card"><div class="h3">การจัดส่ง</div>' + ship + '</div>' +
        (o.note ? '<div class="card"><div class="h3">หมายเหตุ</div><div class="note-box">' + esc(o.note) + '</div></div>' : '') +
        (act ? '<div class="menu-list">' +
          '<button class="mrow" data-act="edit"><span class="ic sky">' + icon('edit') + '</span><span class="t">แก้ไขข้อมูลออเดอร์</span>' + icon('chev', 'chev') + '</button>' +
          '<button class="mrow" data-act="label"><span class="ic mint">' + icon('box') + '</span><span class="t">ใบปะหน้า</span>' + icon('chev', 'chev') + '</button>' +
          '<button class="mrow" data-act="items"><span class="ic peach">' + icon('leaf') + '</span><span class="t">แก้ไขรายการสินค้า</span>' + icon('chev', 'chev') + '</button>' +
          (o.ship_status === 'shipped' ? '<button class="mrow" data-act="unship"><span class="ic lilac">' + icon('undo') + '</span><span class="t">ยกเลิกสถานะส่งแล้ว</span>' + icon('chev', 'chev') + '</button>' : '') +
          '<button class="mrow danger" data-act="cancel"><span class="ic rose">' + icon('close') + '</span><span class="t">ยกเลิกออเดอร์</span></button></div>' : '');
      s.foot.innerHTML = '<button class="btn ghost" data-act="inv">' + icon('receipt') + ' บิล</button>' +
        (act && (bal > 0.005 || over) ? '<button class="btn" data-act="pay">' + icon('cash') + (over ? ' คืนเงิน' : ' รับเงิน') + '</button>' : '') +
        (act && o.ship_status === 'pending' ? '<button class="btn sec" data-act="ship">' + icon('truck') + ' ส่งแล้ว</button>' : '');
      if (!s.bound) {
        s.bound = true;
        const h = {
          pay: () => payDlg(id), ship: () => shipDlg(id), edit: () => editDlg(id),
          items: () => import('./ui-form.js').then((m) => m.openItemsEditor(id)),
          inv: () => openInvoice(id),
          label: () => openLabel(id),
          delpay: (d) => {
            const o2 = findOrder(id), p = (o2.payments || []).find((x) => x.id === d.id); if (!p) return;
            const t = PT[p.type] || PT.payment;
            confirmDlg('ลบรายการรับเงินนี้?', fmtDate(p.date) + ' · ' + t[1] + ' ' + money(p.amount) + ' — ยอดจ่ายแล้วจะถูกคำนวณใหม่', 'ลบรายการ', () => S.deletePayment(id, d.id).then(() => { toast('ลบรายการรับเงินแล้ว'); s.render(); }));
          },
          unship: () => S.unmarkShipped(id).then(() => { toast('ยกเลิกสถานะส่งแล้ว'); s.render(); }),
          cancel: () => {
            const o2 = findOrder(id);
            confirmDlg('ยกเลิกออเดอร์นี้?', 'ออเดอร์ ' + (o2.invoice_no || '') + ' จะถูกยกเลิก และต้นไม้จะถูกคืนเข้าสต็อก', 'ยกเลิกออเดอร์', () => S.cancelOrder(id).then(() => { toast('ยกเลิกออเดอร์แล้ว'); s.render(); }));
          },
        };
        bind(s.body, h); bind(s.foot, h);
      }
    },
  });
}

function segHtml(type) { return [['deposit', 'มัดจำ'], ['payment', 'ชำระเงิน'], ['refund', 'คืนเงิน']].map((x) => '<button data-pt="' + x[0] + '" class="' + (type === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join(''); }
function payDlg(id) {
  const S = ctx.store, o = findOrder(id), bal = balanceOf(o), over = bal < -0.005;
  let manual = false, type = over ? 'refund' : 'payment';
  const noPays = !(o.payments || []).length;
  const d = dialog('บันทึกรับเงิน', '<div class="sub">' + (over ? 'จ่ายเกินอยู่ ' + money(-bal) : 'ค้างชำระ ' + money(bal)) + '</div><label class="fld">ประเภท</label><div class="seg" id="d-seg">' + segHtml(type) + '</div>' +
    '<label class="fld">จำนวนเงิน (บาท)</label><input type="number" inputmode="decimal" id="d-amt" value="' + (over ? -bal : Math.max(0, bal)) + '"><label class="fld">วันที่</label><input type="date" id="d-date" value="' + esc(today()) + '"><label class="fld">หมายเหตุ (ไม่บังคับ)</label><input id="d-note" placeholder="เช่น โอนผ่าน KBank">',
    'บันทึก', (dd) => {
      let amt = num($('#d-amt', dd.el).value); if (!amt) { toast('กรุณาใส่จำนวนเงิน', true); return false; }
      if (type === 'refund') amt = -Math.abs(amt); else if (amt < 0) type = 'refund';
      return S.recordPayment(id, { amount: amt, date: $('#d-date', dd.el).value || today(), type, note: $('#d-note', dd.el).value.trim() }).then(() => { toast('บันทึกรับเงินแล้ว'); });
    });
  const seg = $('#d-seg', d.el), amtEl = $('#d-amt', d.el);
  seg.onclick = (e) => { const t = e.target.closest('[data-pt]'); if (!t) return; manual = true; type = t.dataset.pt; seg.innerHTML = segHtml(type); };
  amtEl.oninput = () => { if (manual || over || !noPays) return; const a = num(amtEl.value), nt = a > 0 && a < bal ? 'deposit' : 'payment'; if (nt !== type) { type = nt; seg.innerHTML = segHtml(type); } };
}
function shipDlg(id) {
  const o = findOrder(id);
  dialog('ทำเครื่องหมายส่งแล้ว', '<label class="fld">วันที่ส่ง</label><input type="date" id="d-date" value="' + esc(today()) + '"><label class="fld">เลขพัสดุ (ถ้ามี)</label><input id="d-trk" value="' + esc(o.tracking_no) + '" autocomplete="off">', 'ยืนยันส่งแล้ว', (d) =>
    ctx.store.markShipped(id, { date: $('#d-date', d.el).value || today(), tracking_no: $('#d-trk', d.el).value.trim() }).then(() => toast('บันทึกว่าส่งแล้ว')));
}
function editDlg(id) {
  const o = findOrder(id);
  dialog('แก้ไขออเดอร์', '<div class="grid2"><div><label class="fld">วันที่สั่ง</label><input type="date" id="e-od" value="' + esc(o.order_date) + '"></div><div><label class="fld">กำหนดส่ง</label><input type="date" id="e-sd" value="' + esc(o.ship_date) + '"></div>' +
    '<div><label class="fld">ค่าส่ง</label><input type="number" inputmode="decimal" id="e-fee" value="' + num(o.shipping_fee) + '"></div><div><label class="fld">ส่วนลด</label><input type="number" inputmode="decimal" id="e-disc" value="' + num(o.discount) + '"></div></div>' +
    '<label class="fld">เลขพัสดุ</label><input id="e-trk" value="' + esc(o.tracking_no) + '"><label class="fld">หมายเหตุ</label><textarea id="e-note">' + esc(o.note) + '</textarea>', 'บันทึก', (d) => {
      const q = (i) => $(i, d.el).value;
      return ctx.store.updateOrder(id, { order_date: q('#e-od') || o.order_date, ship_date: q('#e-sd'), shipping_fee: num(q('#e-fee')), discount: num(q('#e-disc')), tracking_no: q('#e-trk').trim(), note: q('#e-note').trim() }).then(() => toast('บันทึกแล้ว'));
    });
}

// ---------------------------------------------------------------- invoice
export function openInvoice(id) {
  const o = findOrder(id); if (!o) return;
  let file = null, name = 'invoice.png';
  const s = openSheet({
    title: 'บิล ' + (o.invoice_no || ''),
    build(sh) {
      sh.body.innerHTML = '<div class="inv-wrap"><div class="spin" style="margin:60px 0"></div></div>';
      sh.foot.innerHTML = '';
    },
  });
  (async () => {
    try {
      const m = await import('./invoice.js');
      const cur = findOrder(id) || o;
      const cu = ctx.store.getCustomer(cur.customer_id) || { name: cur.customer_name };
      const canvas = await m.renderInvoice({ order: cur, settings: ctx.store.state.settings, customer: cu });
      if (s.closed) return;
      name = m.invoiceFileName(cur);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      file = new File([blob], name, { type: 'image/png' });
      const wrap = $('.inv-wrap', s.body); wrap.innerHTML = ''; wrap.appendChild(canvas);
      const share = canShareFile(file);
      s.foot.innerHTML = (share ? '<button class="btn ghost" data-x="save">' + icon('download') + ' บันทึกรูป</button><button class="btn" data-x="share">' + icon('share') + ' แชร์</button>' : '<button class="btn" data-x="save">' + icon('download') + ' ดาวน์โหลดรูปบิล</button>');
      s.foot.hidden = false;
      s.foot.onclick = (e) => {
        const b = e.target.closest('[data-x]'); if (!b) return;
        if (b.dataset.x === 'save') { downloadBlob(file, name); toast('บันทึกรูปบิลแล้ว'); }
        else navigator.share({ files: [file], title: name }).catch(() => {});
      };
    } catch (e) {
      if (!s.closed) $('.inv-wrap', s.body).innerHTML = '<div class="empty"><div class="t">สร้างบิลไม่สำเร็จ</div><p>' + esc(errMsg(e)) + '</p></div>';
    }
  })();
}


// ---------------------------------------------------------------- shipping label (SPEC6 §2)
export function openLabel(id) {
  const S = ctx.store, o = findOrder(id); if (!o) return;
  const cu = S.getCustomer(o.customer_id);
  const base = { name: '', phone: '', address: '', country: '' };
  const d0 = import('./label.js');
  const v = Object.assign({}, base), st = { copies: 1, save: false, saved: '', canvas: null, tok: 0, lm: null };
  const setting = () => S.state.settings;
  const sheet = openSheet({
    title: 'ใบปะหน้า', live: false, sticky: true,
    build(sh) {
      sh.body.innerHTML = '<div class="lbl-stage" id="l-stage"><div class="spin"></div></div><div class="lbl-meta" id="l-meta"></div><div class="lbl-warn" id="l-warn" hidden>' + icon('alert') + '<span id="l-warn-t"></span></div>' +
        '<div class="card" style="margin-top:14px"><label class="fld">ชื่อผู้รับ</label><input id="l-name" autocomplete="off"><label class="fld">เบอร์โทร</label><input id="l-phone" type="tel" inputmode="tel" autocomplete="off"><label class="fld">ที่อยู่</label><textarea id="l-addr" style="min-height:96px"></textarea><label class="fld">ประเทศ (ไม่ต้องใส่ถ้าส่งในไทย)</label><input id="l-country" autocomplete="off">' +
        (cu ? '<label class="switch" style="margin-top:10px"><input type="checkbox" id="l-save"> บันทึกข้อมูลนี้ลงลูกค้า</label>' : '') + '</div>' +
        '<div class="lbl-copies"><span>จำนวนใบ</span><div class="stepper"><button type="button" data-act="cm" aria-label="ลดจำนวนใบ">−</button><b id="l-n">1</b><button type="button" data-act="cp" aria-label="เพิ่มจำนวนใบ">+</button></div></div>';
      sh.foot.style.flexWrap = 'wrap';
      sh.foot.innerHTML = '<button class="btn" data-act="share" style="flex:1 0 100%">' + icon('share') + ' แชร์ / ส่งไปแอปเครื่องพิมพ์</button><button class="btn ghost" data-act="save">' + icon('download') + ' บันทึกรูป</button><button class="btn sec" data-act="print">' + icon('print') + ' พิมพ์</button>';
    },
  });
  const g = (i) => $('#' + i, sheet.el);
  const sync = () => { g('l-n').textContent = st.copies; };
  const warn = () => {
    const miss = []; if (!v.address.trim()) miss.push('ที่อยู่'); if (!v.phone.trim()) miss.push('เบอร์โทร');
    g('l-warn').hidden = !miss.length; g('l-warn-t').textContent = miss.length ? 'ยังไม่มี' + miss.join(' และ ') + 'ผู้รับ' : '';
  };
  async function draw() {
    const tok = ++st.tok, lm = st.lm;
    try {
      const data = lm.labelData({ order: findOrder(id) || o, customer: cu, settings: setting(), overrides: v });
      const canvas = await lm.renderLabel(data, setting());
      if (tok !== st.tok || sheet.closed) return;
      const px = lm.labelPixelSize(setting());
      canvas.style.width = Math.round(px.w_mm * 6.5) + 'px';
      st.canvas = canvas;
      const stage = g('l-stage'); stage.innerHTML = ''; stage.appendChild(canvas);
      g('l-meta').textContent = px.w_mm + ' × ' + px.h_mm + ' มม. · ' + px.dpi + ' dpi' + (canvas.dataset.truncated ? ' · ข้อความยาวเกินพื้นที่ ถูกตัดบางส่วน' : '');
    } catch (e) { if (!sheet.closed) g('l-stage').innerHTML = '<div class="sub">สร้างใบปะหน้าไม่สำเร็จ: ' + esc(errMsg(e)) + '</div>'; }
  }
  const redraw = debounce(draw, 220);
  const fields = { 'l-name': 'name', 'l-phone': 'phone', 'l-addr': 'address', 'l-country': 'country' };
  Object.keys(fields).forEach((i) => g(i).addEventListener('input', (e) => { v[fields[i]] = e.target.value; warn(); redraw(); }));
  if (cu) g('l-save').addEventListener('change', (e) => { st.save = e.target.checked; });
  d0.then((lm) => {
    st.lm = lm;
    const d = lm.labelData({ order: o, customer: cu, settings: setting() });
    ['name', 'phone', 'address', 'country'].forEach((k) => { v[k] = d[k]; });
    Object.keys(fields).forEach((i) => { g(i).value = v[fields[i]]; });
    warn(); draw();
  }, (e) => toast(errMsg(e), true));

  function saveToCustomer() {
    if (!cu || !st.save) return;
    const sig = JSON.stringify(v); if (sig === st.saved) return;
    st.saved = sig;
    const patch = { id: cu.id, name: v.name.trim() || cu.name, phone: v.phone.trim(), address: v.address.trim(), country: v.country.trim() };
    S.saveCustomer(patch).then(() => toast('บันทึกข้อมูลลงลูกค้าแล้ว'), (e) => { st.saved = ''; toast(errMsg(e), true); });
  }
  async function ready() {
    if (!st.lm) return null;
    st.tok++; // cancel any pending low-priority redraw result
    await draw();
    saveToCustomer();
    return st.canvas;
  }
  bind(sheet.body, { cm: () => { st.copies = Math.max(1, st.copies - 1); sync(); }, cp: () => { st.copies = Math.min(10, st.copies + 1); sync(); } });
  bind(sheet.foot, {
    share: async () => {
      const c = await ready(); if (!c) return;
      const blob = await st.lm.labelBlob(c), r = await shareOrDownload(blob, st.lm.labelFileName(o), 'image/png');
      if (r !== 'cancel') toast(r === 'shared' ? 'ส่งใบปะหน้าแล้ว' : 'บันทึกรูปใบปะหน้าแล้ว');
    },
    save: async () => {
      const c = await ready(); if (!c) return;
      downloadBlob(await st.lm.labelBlob(c), st.lm.labelFileName(o)); toast('บันทึกรูปใบปะหน้าแล้ว');
    },
    print: async () => {
      const c = await ready(); if (!c) return;
      const blob = await st.lm.labelBlob(c), url = URL.createObjectURL(blob), px = st.lm.labelPixelSize(setting());
      const pr = $('#print'); pr.className = 'lbl';
      pr.innerHTML = Array.from({ length: st.copies }, () => '<img alt="" src="' + url + '" style="width:' + px.w_mm + 'mm;height:' + px.h_mm + 'mm">').join('');
      let style = document.getElementById('label-page'); if (style) style.remove();
      style = document.createElement('style'); style.id = 'label-page';
      style.textContent = '@page{size:' + px.w_mm + 'mm ' + px.h_mm + 'mm;margin:0}@media print{html,body{width:' + px.w_mm + 'mm;margin:0;padding:0}}';
      document.head.appendChild(style);
      const done = () => { window.removeEventListener('afterprint', done); style.remove(); pr.className = ''; pr.innerHTML = ''; setTimeout(() => URL.revokeObjectURL(url), 1000); };
      window.addEventListener('afterprint', done);
      const imgs = Array.from(pr.querySelectorAll('img'));
      try { await Promise.all(imgs.map((im) => (im.decode ? im.decode() : Promise.resolve()))); } catch (e) { /* ignore */ }
      window.print();
    },
  });
  sync();
}
