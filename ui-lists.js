// Plants tab (+ plant form, photo viewer) and customers (list, detail, form).
import { ctx, $, esc, num, str, sum, money, fmtDate, icon, chIcon, thumbHTML, toast, openSheet, confirmDlg, bind, debounce, CH, errMsg, emptyHTML, moreBtn, pill, isActive, balanceOf, busy, today, sortBarHTML, getPickSort, setPickSort, sortPlants, soldHint } from './ui-core.js';
import { orderCard, openOrder } from './ui-orders.js';
import { openCropper, showCropped } from './ui-crop.js';

// ---------------------------------------------------------------- plants
let soldLoading = false, soldLoaded = false;

function plantRow(p, sold) {
  const q = num(p.qty);
  const right = sold ? (p.sold_at ? '<div class="sub">ขาย ' + esc(fmtDate(String(p.sold_at).slice(0, 10), true)) + '</div>' : '')
    : (q > 1 ? '<div style="margin-top:4px">' + pill('sky', 'เหลือ ' + q) + '</div>' : '');
  return '<div class="prow" role="button" tabindex="0" data-act="plant" data-id="' + esc(p.id) + '"><button class="thumb" data-act="photo" data-id="' + esc(p.id) + '" aria-label="ดูรูป">' + (p.thumb ? '<img alt="" decoding="async" loading="lazy" src="' + esc(p.thumb) + '">' : icon('leaf')) + '</button>' +
    '<div class="grow"><div class="nm clamp2">' + esc(p.name) + '</div><div class="sub trunc">' + esc(p.code) + esc(soldHint(p)) + (p.detail ? ' · ' + esc(p.detail) : '') + '</div></div><div class="right"><div class="pr">' + money(p.price) + '</div>' + right + '</div></div>';
}

export const plantsView = {
  mount(el) {
    const ui = ctx.ui;
    el.innerHTML = '<div class="search"><span>' + icon('search') + '</span><input id="psearch" type="search" placeholder="ค้นหาต้นไม้ ชื่อ รหัส หรือรายละเอียด" value="' + esc(ui.pq) + '" autocomplete="off"></div><div class="seg" id="pseg"></div>' + sortBarHTML(' id="psortw"') + '<div class="list" id="plist"></div>';
    const upd = () => this.update(el);
    $('#psearch', el).addEventListener('input', debounce((e) => { ui.pq = e.target.value; ui.limP = 60; upd(); }, 200));
    bind(el, {
      plant: (d) => openPlantForm(d.id),
      photo: (d, t, e) => { e.stopPropagation(); openPhoto(d.id); },
      more: () => { ui.limP += 60; upd(); },
      tab: async (d) => {
        ui.sold = d.s === '1'; ui.limP = 60; upd();
        if (ui.sold && !soldLoaded) await loadSold(upd);
      },
      moresold: () => loadSold(upd),
      new: () => openPlantForm(''),
    });
    el.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.sort !== undefined) { setPickSort(e.target.value); ui.limP = 60; upd(); } });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.act === 'plant') openPlantForm(e.target.dataset.id); });
    this.update(el);
  },
  update(el) {
    const ui = ctx.ui, st = ctx.store.state, q = ui.pq.trim().toLowerCase();
    $('#pseg', el).innerHTML = '<button data-act="tab" data-s="0" class="' + (ui.sold ? '' : 'on') + '">มีสต็อก</button><button data-act="tab" data-s="1" class="' + (ui.sold ? 'on' : '') + '">ขายแล้ว</button>';
    let l = st.plants.filter((p) => (ui.sold ? num(p.qty) <= 0 : num(p.qty) > 0) && (!q || (str(p.name) + ' ' + str(p.code) + ' ' + str(p.detail)).toLowerCase().includes(q)));
    if (ui.sold) l = l.sort((a, b) => (str(b.sold_at) > str(a.sold_at) ? 1 : -1)); else l = sortPlants(l, getPickSort());
    $('#psortw', el).hidden = ui.sold;
    let h = '';
    if (soldLoading && ui.sold) h = '<div class="more"><span class="spin"></span></div>';
    else if (!l.length) {
      h = ui.sold ? emptyHTML('🪴', 'ยังไม่มีต้นที่ขายแล้ว', q ? 'ลองค้นหาด้วยคำอื่น' : '', '', '')
        : (q ? emptyHTML('🔍', 'ไม่พบต้นไม้', 'ลองค้นหาด้วยคำอื่น', '', '') : emptyHTML('🌿', 'ยังไม่มีต้นไม้ในสต็อก', 'เพิ่มต้นแรกพร้อมรูปและราคา เพื่อใช้ในออเดอร์', 'เพิ่มต้นไม้', 'new'));
    } else {
      h = l.slice(0, ui.limP).map((p) => plantRow(p, ui.sold)).join('');
      if (l.length > ui.limP) h += moreBtn('more');
    }
    if (ui.sold && soldLoaded && st.hasMoreSold !== false && !soldLoading) h += moreBtn('moresold', 'โหลดต้นที่ขายแล้วเพิ่ม');
    $('#plist', el).innerHTML = h;
  },
};
async function loadSold(upd) {
  const S = ctx.store;
  soldLoading = true; upd();
  try { await S.loadSoldPlants(); soldLoaded = true; } catch (e) { toast(errMsg(e), true); }
  soldLoading = false;
  upd();
}

function openPhoto(id) {
  const S = ctx.store, p = S.getPlant(id); if (!p) return;
  const s = openSheet({ title: p.name, build(sh) { sh.body.innerHTML = '<div class="inv-wrap" style="min-height:240px">' + (p.thumb ? '<img alt="" src="' + esc(p.thumb) + '" style="width:100%;filter:blur(2px)">' : '') + '</div>'; } });
  if (!p.has_photo && !p.thumb) { $('.inv-wrap', s.body).innerHTML = '<div class="empty"><div class="em">🌿</div><p>ต้นนี้ยังไม่มีรูป</p></div>'; return; }
  S.getPlantPhotoDoc(id).then((doc) => {
    if (s.closed) return;
    const w = $('.inv-wrap', s.body);
    if (doc && doc.data) { w.style.minHeight = '0'; return showCropped(w, doc.data, doc.crop, p.name); }
    w.innerHTML = p.thumb ? '<img alt="" src="' + esc(p.thumb) + '" style="width:100%">' : '<div class="empty"><p>ไม่พบรูป</p></div>';
  }).catch(() => {});
}

export function openPlantForm(id) {
  const S = ctx.store, p0 = id ? S.getPlant(id) : null;
  if (id && !p0) return;
  const p = p0 || { name: '', detail: '', price: '', qty: 1, note: '' };
  let photo = null, stored = null, preview = p.thumb || '';
  openSheet({
    title: id ? 'แก้ไข ' + p.code : 'เพิ่มต้นไม้', sticky: true,
    build(s) {
      const B = s.body;
      B.innerHTML = '<div class="card"><div class="row" style="gap:16px"><div class="thumb" id="p-prev" style="width:96px;height:96px;border-radius:24px"></div><div class="grow"><label class="btn sec sm block" style="cursor:pointer">' + icon('camera') + ' <span id="p-lbl">ถ่าย / เลือกรูป</span><input type="file" accept="image/*" id="p-file" hidden></label><div class="grid2" id="p-ph2" style="margin-top:8px" hidden><button class="btn ghost sm" id="p-recrop">ครอปใหม่</button><button class="btn ghost sm" id="p-nophoto">ลบรูป</button></div></div></div></div>' +
        '<div class="card"><label class="fld">ชื่อต้นไม้ *</label><input id="p-name" value="' + esc(p.name) + '" autocomplete="off"><label class="fld">รายละเอียด</label><input id="p-detail" value="' + esc(p.detail) + '" placeholder="เช่น ขนาดกระถาง / ลักษณะใบ" autocomplete="off">' +
        '<div class="grid2"><div><label class="fld">ราคา (บาท) *</label><input id="p-price" type="number" inputmode="decimal" value="' + esc(p.price) + '"></div><div><label class="fld">จำนวน</label><input id="p-qty" type="number" inputmode="numeric" value="' + esc(p.qty) + '"></div></div>' +
        '<label class="fld">หมายเหตุ</label><textarea id="p-note" style="min-height:70px">' + esc(p.note) + '</textarea></div>' +
        (id ? '<button class="btn warn block" id="p-del">' + icon('trash') + ' ลบต้นไม้นี้</button>' : '');
      s.foot.innerHTML = '<button class="btn block" id="p-save">บันทึก</button>';
      const draw = () => { $('#p-prev', B).innerHTML = preview ? '<img alt="" src="' + esc(preview) + '">' : icon('leaf'); $('#p-ph2', B).hidden = !preview; $('#p-recrop', B).hidden = !canRecrop(); $('#p-lbl', B).textContent = preview ? 'เปลี่ยนรูป' : 'ถ่าย / เลือกรูป'; };
      // re-crop is possible for a freshly chosen photo, or when the stored original still exists
      const canRecrop = () => !!((photo && photo.full) || (id && p.has_photo && photo === null) || (id && p.has_photo && photo && !photo.full));
      draw();
      $('#p-file', B).onchange = async (e) => {
        const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
        const r = await openCropper(file);
        if (!r || s.closed) return;
        photo = { thumb: r.thumb, full: r.full, crop: r.crop }; stored = null; preview = r.thumb; draw();
      };
      $('#p-recrop', B).onclick = async () => {
        let data, crop;
        if (photo && photo.full) { data = photo.full; crop = photo.crop; }
        else {
          if (!stored) {
            const end = busy('กำลังโหลดรูป…');
            try { stored = await S.getPlantPhotoDoc(id); } catch (er) { /* ignore */ }
            end();
          }
          if (!stored || !stored.data) return toast('ไม่พบรูปต้นฉบับ — เลือกรูปใหม่แทน', true);
          data = stored.data; crop = (photo && photo.crop) || stored.crop;
        }
        const r = await openCropper(data, { crop, title: 'ครอปรูปใหม่' });
        if (!r || s.closed) return;
        if (photo && photo.full) photo = { thumb: r.thumb, full: photo.full, crop: r.crop }; else photo = { thumb: r.thumb, crop: r.crop };
        preview = r.thumb; draw();
      };
      $('#p-nophoto', B).onclick = () => { photo = false; preview = ''; stored = null; draw(); };
      const del = $('#p-del', B);
      if (del) del.onclick = () => confirmDlg('ลบต้นไม้นี้?', 'ลบ "' + p.name + '" ออกจากระบบ (ประวัติออเดอร์ยังอยู่)', 'ลบ', () => S.deletePlant(id).then(() => { s.close(); toast('ลบแล้ว'); }));
      $('#p-save', s.foot).onclick = () => {
        const name = $('#p-name', B).value.trim(), priceS = $('#p-price', B).value;
        if (!name) return toast('กรุณากรอกชื่อต้นไม้', true);
        if (priceS === '' || num(priceS) < 0) return toast('กรุณากรอกราคา', true);
        const rec = Object.assign({}, p0 || {}, { name, detail: $('#p-detail', B).value.trim(), price: num(priceS), qty: Math.max(0, Math.round(num($('#p-qty', B).value))), note: $('#p-note', B).value.trim() });
        S.savePlant(rec, photo).then(() => { s.close(); toast(id ? 'บันทึกแล้ว' : 'เพิ่มต้นไม้แล้ว'); }, (e) => toast(errMsg(e), true));
      };
    },
  });
}

// ---------------------------------------------------------------- customers
const custOrders = (id) => ctx.store.state.orders.filter((o) => o.customer_id === id);
const custStats = (list) => { const a = list.filter(isActive); return { n: a.length, total: sum(a, (o) => o.total), owe: sum(a, (o) => Math.max(0, balanceOf(o))) }; };

export const customersView = {
  mount(el) {
    const ui = ctx.ui;
    el.innerHTML = '<div class="search"><span>' + icon('search') + '</span><input id="csearch" type="search" placeholder="ค้นหาชื่อ เบอร์โทร ช่องทางติดต่อ หรือประเทศ" value="' + esc(ui.cq) + '" autocomplete="off"></div><div class="chips" id="cchips"></div><div class="list" id="clist"></div>';
    const upd = () => this.update(el);
    $('#csearch', el).addEventListener('input', debounce((e) => { ui.cq = e.target.value; ui.limC = 60; upd(); }, 200));
    bind(el, { cust: (d) => openCustomer(d.id), ch: (d) => { ui.cch = d.k; ui.limC = 60; upd(); }, more: () => { ui.limC += 60; upd(); }, new: () => openCustomerForm('') });
    this.update(el);
  },
  update(el) {
    const ui = ctx.ui, st = ctx.store.state, q = ui.cq.trim().toLowerCase();
    $('#cchips', el).innerHTML = [['all', 'ทั้งหมด']].concat(Object.entries(CH)).map((c) => '<button class="chip' + (ui.cch === c[0] ? ' on' : '') + '" data-act="ch" data-k="' + c[0] + '">' + esc(c[1]) + '</button>').join('');
    const l = st.customers.filter((c) => (ui.cch === 'all' || c.channel === ui.cch) && (!q || (str(c.name) + ' ' + str(c.contact) + ' ' + str(c.phone) + ' ' + str(c.country)).toLowerCase().includes(q)));
    let h = '';
    if (!l.length) h = !st.customers.length ? emptyHTML('👋', 'ยังไม่มีลูกค้า', 'ลูกค้าจะถูกเพิ่มอัตโนมัติเมื่อสร้างออเดอร์ หรือเพิ่มเองได้เลย', 'เพิ่มลูกค้า', 'new') : emptyHTML('🔍', 'ไม่พบลูกค้า', 'ลองค้นหาด้วยคำอื่น', '', '');
    else {
      const owe = new Map();
      st.orders.forEach((o) => { if (isActive(o) && balanceOf(o) > 0.005) owe.set(o.customer_id, (owe.get(o.customer_id) || 0) + balanceOf(o)); });
      h = l.slice(0, ui.limC).map((c) => {
        const ow = owe.get(c.id);
        return '<button class="prow" style="padding:12px 14px" data-act="cust" data-id="' + esc(c.id) + '"><span class="ava ' + esc(c.channel) + '">' + chIcon(c.channel) + '</span><span class="grow"><span class="nm trunc" style="display:block">' + esc(c.name) + '</span><span class="sub trunc" style="display:block">' + esc([CH[c.channel], c.country, c.phone, c.contact].filter(Boolean).join(' · ')) + '</span></span>' + (ow ? '<span class="right"><span class="pill p-butter">ค้าง ' + esc(money(ow)) + '</span></span>' : '') + '</button>';
      }).join('');
      if (l.length > ui.limC) h += moreBtn('more');
    }
    $('#clist', el).innerHTML = h;
  },
};

export function openCustomer(id) {
  const S = ctx.store, d = { loaded: null, loading: true };
  openSheet({
    title: 'ลูกค้า', live: true,
    build(s) {
      const c = S.getCustomer(id); if (!c) { s.close(); return; }
      const merged = new Map(); custOrders(id).forEach((o) => merged.set(o.id, o)); (d.loaded || []).forEach((o) => merged.set(S.getOrder(o.id) ? S.getOrder(o.id).id : o.id, S.getOrder(o.id) || o));
      const list = Array.from(merged.values()).sort((a, b) => (str(b.order_date) + str(b.code) > str(a.order_date) + str(a.code) ? 1 : -1));
      const st = custStats(list);
      s.setTitle(c.name);
      s.body.innerHTML = '<div class="card"><div class="row"><span class="ava ' + esc(c.channel) + ' avatar-lg">' + chIcon(c.channel) + '</span><div class="grow"><div style="font-weight:700;font-size:19px;line-height:1.35">' + esc(c.name) + '</div><div class="sub">' + esc(c.code) + ' · ' + esc(CH[c.channel] || '') + '</div></div></div>' +
        (c.contact || c.phone || c.country || c.address || c.note ? '<div class="hr"></div>' : '') +
        (c.phone ? '<div class="kv"><span class="sub">เบอร์โทร</span><b style="font-weight:600">' + esc(c.phone) + '</b></div>' : '') + (c.contact ? '<div class="kv"><span class="sub">ติดต่อ</span><b style="font-weight:600">' + esc(c.contact) + '</b></div>' : '') + (c.country ? '<div class="kv"><span class="sub">ประเทศ</span><b style="font-weight:600">' + esc(c.country) + '</b></div>' : '') +
        (c.address ? '<div class="kv"><span class="sub">ที่อยู่</span><b style="font-weight:600;white-space:pre-wrap;word-break:break-word">' + esc(c.address) + '</b></div>' : '') + (c.note ? '<div class="kv"><span class="sub">หมายเหตุ</span><b style="font-weight:600;white-space:pre-wrap">' + esc(c.note) + '</b></div>' : '') + '</div>' +
        '<div class="stats" style="grid-template-columns:repeat(3,1fr);gap:8px"><div class="stat-c" style="min-height:0;padding:12px"><div class="t">ออเดอร์</div><div class="v" style="font-size:22px">' + st.n + '</div></div><div class="stat-c" style="min-height:0;padding:12px"><div class="t">ยอดซื้อรวม</div><div class="v" style="font-size:19px">' + esc(money(st.total)) + '</div></div><div class="stat-c rose' + (st.owe ? ' hot' : '') + '" style="min-height:0;padding:12px"><div class="t">ค้างชำระ</div><div class="v" style="font-size:19px">' + esc(money(st.owe)) + '</div></div></div>' +
        '<div class="h3" style="margin-bottom:0">ออเดอร์ของลูกค้า ' + (d.loading ? '<span class="spin sm" style="display:inline-block;vertical-align:middle;margin-left:6px"></span>' : '') + '</div>' +
        (list.length ? '<div class="list">' + list.map(orderCard).join('') + '</div>' : (d.loading ? '' : '<div class="sub">ยังไม่มีออเดอร์</div>'));
      s.foot.innerHTML = '<button class="btn ghost" data-act="edit">' + icon('edit') + ' แก้ไข</button><button class="btn" data-act="neworder">' + icon('plus') + ' ออเดอร์ใหม่</button>';
      if (!s.bound) {
        s.bound = true;
        const h = { edit: () => openCustomerForm(id), order: (x) => openOrder(x.id), neworder: () => { s.close(); import('./ui-form.js').then((m) => m.openOrderForm({ customerId: id })); } };
        bind(s.body, h); bind(s.foot, h);
      }
    },
  }).data = d;
  S.loadCustomerOrders(id).then((arr) => { d.loaded = arr || []; d.loading = false; (arr || []).forEach((o) => ctx.extra.set(o.id, o)); refreshSoon(); }, () => { d.loading = false; refreshSoon(); });
}
const refreshSoon = () => ctx.nav.rerender();

export function openCustomerForm(id) {
  const S = ctx.store, c0 = id ? S.getCustomer(id) : null, c = c0 || { name: '', channel: 'facebook', contact: '', phone: '', country: '', address: '', note: '' };
  openSheet({
    title: id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า', sticky: true,
    build(s) {
      const B = s.body;
      B.innerHTML = '<div class="card"><label class="fld">ชื่อลูกค้า *</label><input id="c-name" value="' + esc(c.name) + '" autocomplete="off"><label class="fld">ช่องทาง</label><select id="c-ch">' + Object.keys(CH).map((k) => '<option value="' + k + '"' + (c.channel === k ? ' selected' : '') + '>' + CH[k] + '</option>').join('') + '</select>' +
        '<label class="fld">ช่องทางติดต่อ (ชื่อ FB / IG)</label><input id="c-contact" value="' + esc(c.contact) + '"><label class="fld">เบอร์โทร</label><input id="c-phone" type="tel" inputmode="tel" autocomplete="off" value="' + esc(c.phone) + '"><label class="fld">ประเทศ</label><input id="c-country" value="' + esc(c.country) + '"><label class="fld">ที่อยู่จัดส่ง</label><textarea id="c-addr">' + esc(c.address) + '</textarea><label class="fld">หมายเหตุ</label><textarea id="c-note" style="min-height:70px">' + esc(c.note) + '</textarea></div>' +
        (id ? '<button class="btn warn block" id="c-del">' + icon('trash') + ' ลบลูกค้า</button>' : '');
      s.foot.innerHTML = '<button class="btn block" id="c-save">บันทึก</button>';
      const del = $('#c-del', B);
      if (del) del.onclick = () => confirmDlg('ลบลูกค้านี้?', 'ลบ "' + c.name + '" ออกจากรายชื่อ (ประวัติออเดอร์ยังอยู่)', 'ลบ', () => S.deleteCustomer(id).then(() => { import('./ui-core.js').then((m) => m.closeAllSheets()); toast('ลบแล้ว'); }));
      $('#c-save', s.foot).onclick = () => {
        const name = $('#c-name', B).value.trim(); if (!name) return toast('กรุณากรอกชื่อลูกค้า', true);
        const rec = Object.assign({}, c0 || {}, { name, channel: $('#c-ch', B).value, contact: $('#c-contact', B).value.trim(), phone: $('#c-phone', B).value.trim(), country: $('#c-country', B).value.trim(), address: $('#c-addr', B).value.trim(), note: $('#c-note', B).value.trim() });
        S.saveCustomer(rec).then(() => { s.close(); toast(id ? 'บันทึกแล้ว' : 'เพิ่มลูกค้าแล้ว'); }, (e) => toast(errMsg(e), true));
      };
    },
  });
}
