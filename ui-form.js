// Item picker, new-order form (incl. quick walk-in sale), item editor, photo import.
import { ctx, $, esc, num, str, sum, debounce, money, icon, chIcon, thumbHTML, toast, openSheet, dialog, bind, CH, WALKIN_NAME, errMsg, busy, today, findOrder, fmtDate } from './ui-core.js';

// ---------------------------------------------------------------- item picker
// f = {items:[{plant_id,code,name,unit_price,qty,max?,custom?}], bonus:{plantId:qty already in this order}}
export function itemsPicker(host, f, onChange) {
  f.bonus = f.bonus || {};
  host.innerHTML = '<div data-r="lines"></div>' +
    '<div class="search" style="margin-top:12px"><span>' + icon('search') + '</span><input data-r="q" placeholder="ค้นหาต้นไม้ ชื่อหรือรหัส" enterkeyhint="search" autocomplete="off"></div>' +
    '<div class="picklist" data-r="res" style="margin-top:8px"></div>' +
    '<button class="btn sec block" data-act="custom" style="margin-top:10px">' + icon('plus') + ' เพิ่มรายการเอง</button>';
  const R = (k) => host.querySelector('[data-r="' + k + '"]');
  const stockOf = (id) => { const p = ctx.store.getPlant(id); return (p ? num(p.qty) : 0) + num(f.bonus[id]); };
  const lineQty = (id) => sum(f.items.filter((i) => i.plant_id === id), (i) => i.qty);

  function drawLines() {
    const el = R('lines');
    el.innerHTML = f.items.map((it, i) => {
      const head = it.custom
        ? '<input data-in="' + i + '" value="' + esc(it.name) + '" placeholder="ชื่อรายการ เช่น กระถาง / ค่าบริการ" aria-label="ชื่อรายการ">'
        : '<div class="nm">' + esc(it.name) + '</div>' + (it.code ? '<div class="sub">' + esc(it.code) + (it.max ? ' · เหลือ ' + it.max : '') + '</div>' : '');
      return '<div class="line"><div class="row"><div class="grow">' + head + '</div><button class="xbtn" data-act="rm" data-i="' + i + '" aria-label="ลบรายการ">' + icon('close') + '</button></div>' +
        '<div class="ctl"><div class="pr"><input type="number" inputmode="decimal" data-ip="' + i + '" value="' + (it.unit_price || '') + '" placeholder="ราคา" aria-label="ราคาต่อหน่วย"></div>' +
        '<div class="stepper"><button data-act="dec" data-i="' + i + '" aria-label="ลด">−</button><b>' + it.qty + '</b><button data-act="inc" data-i="' + i + '" aria-label="เพิ่ม">+</button></div>' +
        '<div class="tot" data-lt="' + i + '">' + money(num(it.unit_price) * it.qty) + '</div></div></div>';
    }).join('');
  }
  function drawRes() {
    const q = R('q').value.trim().toLowerCase();
    const l = ctx.store.state.plants.filter((p) => num(p.qty) > 0 && stockOf(p.id) > lineQty(p.id) && (!q || (str(p.name) + ' ' + str(p.code) + ' ' + str(p.detail)).toLowerCase().includes(q))).slice(0, 25);
    R('res').hidden = false;
    R('res').innerHTML = l.length ? l.map((p) => '<button class="pick" data-act="add" data-id="' + esc(p.id) + '">' + thumbHTML(p, 'sm') + '<span class="grow"><span class="nm trunc" style="display:block">' + esc(p.name) + '</span><span class="sub">' + esc(p.code) + ' · เหลือ ' + num(p.qty) + '</span></span><b class="num">' + money(p.price) + '</b></button>').join('')
      : '<div class="sub" style="padding:14px;text-align:center">' + (q ? 'ไม่พบต้นไม้ที่ค้นหา' : 'ไม่มีต้นไม้ในสต็อกที่เลือกได้') + '</div>';
  }
  function addPlant(p) {
    const ex = f.items.find((i) => i.plant_id === p.id);
    if (ex) { if (ex.qty < stockOf(p.id)) ex.qty++; }
    else f.items.push({ plant_id: p.id, code: p.code, name: p.name, unit_price: num(p.price), qty: 1, max: stockOf(p.id) });
    drawLines(); drawRes(); onChange();
  }
  bind(host, {
    add: (d) => { const p = ctx.store.getPlant(d.id); if (p) addPlant(p); },
    rm: (d) => { f.items.splice(+d.i, 1); drawLines(); drawRes(); onChange(); },
    inc: (d) => { const it = f.items[+d.i]; if (it.plant_id && it.qty >= stockOf(it.plant_id)) { toast('สต็อกมีแค่ ' + stockOf(it.plant_id), true); return; } it.qty++; drawLines(); drawRes(); onChange(); },
    dec: (d) => { const it = f.items[+d.i]; if (it.qty > 1) { it.qty--; drawLines(); drawRes(); onChange(); } },
    custom: () => { f.items.push({ plant_id: '', code: '', name: '', unit_price: 0, qty: 1, custom: true }); drawLines(); onChange(); const el = host.querySelector('[data-in="' + (f.items.length - 1) + '"]'); if (el) el.focus(); },
  });
  host.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.ip !== undefined) { const it = f.items[+t.dataset.ip]; it.unit_price = num(t.value); const lt = host.querySelector('[data-lt="' + t.dataset.ip + '"]'); if (lt) lt.textContent = money(it.unit_price * it.qty); onChange(); }
    else if (t.dataset.in !== undefined) { f.items[+t.dataset.in].name = t.value; }
    else if (t.dataset.r === 'q') drawResD();
  });
  const drawResD = debounce(drawRes, 120);
  drawLines(); drawRes();
  return { redraw() { drawLines(); drawRes(); } };
}

const payloadItems = (f) => f.items.map((i) => ({ plant_id: i.plant_id, name: str(i.name).trim(), unit_price: num(i.unit_price), qty: i.qty }));

// ---------------------------------------------------------------- new order
export function openOrderForm(opt) {
  opt = opt || {};
  const quick = !!opt.quick, S = ctx.store, st = S.state;
  const f = { chat: '', mode: 'existing', cid: opt.customerId || '', cq: '', nc: { name: '', contact: '', country: '', address: '' }, channel: quick ? 'walkin' : 'facebook', shipped: true, items: [], pm: quick ? 'full' : 'none', pt: 'payment', ptm: false, qname: '' };
  const cu0 = f.cid && S.getCustomer(f.cid); if (cu0 && CH[cu0.channel]) f.channel = cu0.channel;
  const seg = (id) => '<div class="seg" id="' + id + '"></div>';

  openSheet({
    title: quick ? 'ขายหน้าร้านด่วน' : 'ออเดอร์ใหม่', sticky: true,
    build(s) {
      const B = s.body;
      if (quick) {
        B.innerHTML = '<div class="card"><div class="h3">เลือกต้นไม้ที่ขาย</div><div id="f-items"></div></div>' +
          '<div class="card"><label class="fld">ชื่อลูกค้า (ไม่บังคับ)</label><input id="f-qn" placeholder="' + WALKIN_NAME + '" autocomplete="off">' +
          '<label class="fld">ส่วนลด (บาท)</label><input id="f-disc" type="number" inputmode="decimal" placeholder="0">' +
          '<label class="switch" style="margin-top:8px"><input type="checkbox" id="f-qpaid" checked> รับเงินครบแล้ว</label></div>' +
          '<div class="card"><div class="kv tot" style="border:0;margin:0;padding:0"><span>ยอดรวม</span><span id="f-tot"></span></div></div>';
      } else {
        B.innerHTML =
          '<div class="card"><button class="row" data-act="chatt" style="width:100%;min-height:44px;font-weight:600;color:var(--sage-d)">' + icon('paste') + '<span class="grow" style="text-align:left">วางข้อความจากแชท (ไม่บังคับ)</span>' + icon('chev') + '</button><div id="f-chatw" hidden><textarea id="f-chat" placeholder="วางข้อความจาก Facebook / Instagram ที่นี่ ระบบจะช่วยหาต้นไม้ที่น่าจะใช่" style="margin-top:8px"></textarea><div id="f-sugg"></div></div></div>' +
          '<div class="card"><div class="h3">ลูกค้า</div>' + seg('f-cm') + '<div id="f-cust" style="margin-top:12px"></div></div>' +
          '<div class="card"><div class="h3">ช่องทาง</div>' + seg('f-ch') + '<label class="switch" id="f-wiw" style="margin-top:10px" hidden><input type="checkbox" id="f-wi" checked> ลูกค้ารับของแล้ว</label></div>' +
          '<div class="card"><div class="h3">รายการสินค้า</div><div id="f-items"></div></div>' +
          '<div class="card"><div class="grid2"><div><label class="fld">ค่าส่ง</label><input id="f-fee" type="number" inputmode="decimal" placeholder="0"></div><div><label class="fld">ส่วนลด</label><input id="f-disc" type="number" inputmode="decimal" placeholder="0"></div>' +
          '<div><label class="fld">วันที่สั่ง</label><input id="f-od" type="date" value="' + esc(st.today) + '"></div><div id="f-sdw"><label class="fld">กำหนดส่ง</label><input id="f-sd" type="date"></div></div></div>' +
          '<div class="card"><div class="h3">รับเงิน</div><input id="f-paid" type="number" inputmode="decimal" placeholder="0" aria-label="รับเงินแล้ว (บาท)">' + '<div class="seg" id="f-pt" style="margin-top:10px"></div>' +
          '<div class="grid3" style="margin-top:10px"><button class="btn sec sm" data-act="paid0">ยังไม่จ่าย</button><button class="btn sec sm" data-act="paidhalf">มัดจำ 50%</button><button class="btn sec sm" data-act="paidfull">จ่ายครบ</button></div></div>' +
          '<div class="card"><label class="fld">หมายเหตุ</label><textarea id="f-note" style="min-height:70px"></textarea></div>' +
          '<div class="card"><div class="kv mut"><span>รวมสินค้า</span><span id="f-sub"></span></div><div class="kv tot"><span>ยอดรวม</span><span id="f-tot"></span></div></div>';
      }
      s.foot.innerHTML = '<button class="btn block" id="f-save"></button>';
      const g = (id) => $('#' + id, B);
      const walkin = () => f.channel === 'walkin';
      const effType = (paid, tot) => (paid <= 0 ? '' : (f.ptm ? f.pt : (paid < tot ? 'deposit' : 'payment')));
      let picker, drawSugg = () => {};

      function totals() {
        const sub = sum(f.items, (i) => num(i.unit_price) * i.qty);
        const tot = Math.max(0, sub + (quick ? 0 : num(g('f-fee').value)) - num(g('f-disc').value));
        return { sub, tot };
      }
      function paidNow(tot) {
        if (quick) return g('f-qpaid').checked ? tot : 0;
        if (f.pm === 'full') return tot;
        if (f.pm === 'half') return Math.round(tot / 2 * 100) / 100;
        if (f.pm === 'none') return 0;
        return num(g('f-paid').value);
      }
      function calc() {
        const { sub, tot } = totals();
        g('f-tot').textContent = money(tot);
        if (!quick) {
          g('f-sub').textContent = money(sub);
          const p = paidNow(tot);
          if (f.pm !== 'custom') g('f-paid').value = p ? p : '';
          const t = effType(p, tot);
          g('f-pt').innerHTML = [['deposit', 'มัดจำ'], ['payment', 'ชำระเงิน']].map((x) => '<button data-act="pt" data-t="' + x[0] + '" class="' + (t === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('');
        }
        const btn = $('#f-save', s.foot); btn.textContent = (quick ? 'ขายเลย' : 'บันทึกออเดอร์') + ' · ' + money(tot);
        return tot;
      }
      picker = itemsPicker(g('f-items'), f, () => { calc(); if (!quick) drawSugg(); });

      if (!quick) {
        const drawSeg = () => {
          g('f-cm').innerHTML = [['existing', 'ลูกค้าเดิม'], ['new', 'ลูกค้าใหม่']].map((m) => '<button data-act="cm" data-m="' + m[0] + '" class="' + (f.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>').join('');
          g('f-ch').innerHTML = Object.keys(CH).map((k) => '<button data-act="ch" data-k="' + k + '" class="' + (f.channel === k ? 'on' : '') + '">' + CH[k] + '</button>').join('');
          g('f-wiw').hidden = !walkin(); g('f-sdw').hidden = walkin() && f.shipped;
        };
        const drawCust = () => {
          const c = g('f-cust');
          if (f.mode === 'new') {
            c.innerHTML = [['name', 'ชื่อลูกค้า *', ''], ['contact', 'ช่องทางติดต่อ (ชื่อ FB / IG / เบอร์)', ''], ['country', 'ประเทศ', '']].map((x) => '<label class="fld">' + x[1] + '</label><input data-nc="' + x[0] + '" value="' + esc(f.nc[x[0]]) + '">').join('') + '<label class="fld">ที่อยู่จัดส่ง</label><textarea data-nc="address" style="min-height:76px">' + esc(f.nc.address) + '</textarea>';
          } else if (f.cid) {
            const cu = S.getCustomer(f.cid);
            c.innerHTML = '<div class="row"><span class="ava ' + esc(cu ? cu.channel : 'other') + '">' + chIcon(cu && cu.channel) + '</span><div class="grow"><div class="nm" style="font-weight:700">' + esc(cu ? cu.name : f.cid) + '</div><div class="sub">' + esc(cu ? [CH[cu.channel], cu.country].filter(Boolean).join(' · ') : '') + '</div></div><button class="btn sec sm" data-act="chg">เปลี่ยน</button></div>';
          } else {
            c.innerHTML = '<div class="search"><span>' + icon('search') + '</span><input id="f-cq" placeholder="ค้นหาชื่อลูกค้า" value="' + esc(f.cq) + '" autocomplete="off"></div>' + (walkin() ? '<div class="sub" style="margin:8px 2px 0">หน้าร้าน: ไม่เลือกลูกค้าก็ได้ (จะบันทึกเป็น "' + WALKIN_NAME + '")</div>' : '') + '<div class="picklist" id="f-cres" style="margin-top:8px"></div>';
            fillCres();
          }
        };
        const fillCres = () => {
          const q = f.cq.trim().toLowerCase(), r = g('f-cres'); if (!r) return;
          const l = st.customers.filter((c) => !q || (str(c.name) + ' ' + str(c.contact) + ' ' + str(c.country)).toLowerCase().includes(q)).slice(0, 8);
          r.innerHTML = l.length ? l.map((c) => '<button class="pick" data-act="pickc" data-id="' + esc(c.id) + '"><span class="ava ' + esc(c.channel) + '" style="width:38px;height:38px;border-radius:13px">' + chIcon(c.channel) + '</span><span class="grow"><span class="nm trunc" style="display:block">' + esc(c.name) + '</span><span class="sub">' + esc([CH[c.channel], c.country].filter(Boolean).join(' · ')) + '</span></span></button>').join('') : '<div class="sub" style="padding:14px;text-align:center">ไม่พบลูกค้า — กด "ลูกค้าใหม่" ด้านบน</div>';
        };
        drawSugg = () => {
          const box = g('f-sugg'), t = f.chat.toLowerCase();
          if (!t.trim()) { box.innerHTML = ''; return; }
          const l = st.plants.filter((p) => num(p.qty) > 0 && !f.items.some((i) => i.plant_id === p.id) && ((p.name && t.includes(str(p.name).toLowerCase())) || (p.code && t.includes(str(p.code).toLowerCase())))).slice(0, 8);
          box.innerHTML = l.length ? '<div class="sub" style="margin:10px 0 6px">ต้นที่น่าจะใช่</div><div class="chips" style="flex-wrap:wrap;overflow:visible;margin:0;padding:0">' + l.map((p) => '<button class="chip add" data-act="addp" data-id="' + esc(p.id) + '">+ ' + esc(p.name) + '</button>').join('') + '</div>' : '';
        };
        bind(B, {
          chatt: () => { g('f-chatw').hidden = !g('f-chatw').hidden; if (!g('f-chatw').hidden) g('f-chat').focus(); },
          cm: (d) => { f.mode = d.m; drawSeg(); drawCust(); },
          ch: (d) => { f.channel = d.k; drawSeg(); if (f.mode === 'existing' && !f.cid) drawCust(); },
          chg: () => { f.cid = ''; f.cq = ''; drawCust(); },
          pickc: (d) => { f.cid = d.id; const cu = S.getCustomer(d.id); if (cu && CH[cu.channel]) f.channel = cu.channel; drawSeg(); drawCust(); },
          addp: (d) => { const p = S.getPlant(d.id); if (p) { f.items.push({ plant_id: p.id, code: p.code, name: p.name, unit_price: num(p.price), qty: 1, max: num(p.qty) }); picker.redraw(); calc(); drawSugg(); } },
          paid0: () => { f.pm = 'none'; f.ptm = false; calc(); },
          paidhalf: () => { f.pm = 'half'; f.pt = 'deposit'; f.ptm = true; calc(); },
          paidfull: () => { f.pm = 'full'; f.ptm = false; calc(); },
          pt: (d) => { f.pt = d.t; f.ptm = true; calc(); },
        });
        B.addEventListener('input', (e) => {
          const t = e.target;
          if (t.id === 'f-chat') { f.chat = t.value; drawSugg(); }
          else if (t.id === 'f-cq') { f.cq = t.value; fillCres(); }
          else if (t.dataset.nc) f.nc[t.dataset.nc] = t.value;
          else if (t.id === 'f-paid') { f.pm = 'custom'; calc(); }
          else if (t.id === 'f-fee' || t.id === 'f-disc') calc();
        });
        B.addEventListener('change', (e) => { if (e.target.id === 'f-wi') { f.shipped = e.target.checked; drawSeg(); } });
        drawSeg(); drawCust();
      } else {
        B.addEventListener('input', (e) => { if (e.target.id === 'f-disc') calc(); else if (e.target.id === 'f-qn') f.qname = e.target.value; });
        B.addEventListener('change', (e) => { if (e.target.id === 'f-qpaid') calc(); });
      }
      calc();

      $('#f-save', s.foot).onclick = () => {
        const items = payloadItems(f);
        if (!items.length) return toast('กรุณาเพิ่มรายการสินค้า', true);
        if (items.some((i) => !i.name)) return toast('กรุณาใส่ชื่อรายการที่เพิ่มเอง', true);
        let newC = null, cid = '';
        const wcust = () => { const wc = st.customers.find((c) => c.name === WALKIN_NAME); if (wc) cid = wc.id; else newC = { name: WALKIN_NAME, channel: 'walkin', contact: '', country: '', address: '', note: '' }; };
        if (quick) {
          const nm = f.qname.trim();
          if (nm) { const ex = st.customers.find((c) => c.name.trim().toLowerCase() === nm.toLowerCase()); if (ex) cid = ex.id; else newC = { name: nm, channel: 'walkin', contact: '', country: '', address: '', note: '' }; } else wcust();
        } else {
          const blank = walkin() && ((f.mode === 'existing' && !f.cid) || (f.mode === 'new' && !f.nc.name.trim()));
          if (blank) wcust();
          else if (f.mode === 'new') {
            if (!f.nc.name.trim()) return toast('กรุณากรอกชื่อลูกค้า', true);
            newC = { name: f.nc.name.trim(), channel: f.channel, contact: f.nc.contact.trim(), country: f.nc.country.trim(), address: f.nc.address.trim(), note: '' };
          } else if (!f.cid) return toast('กรุณาเลือกลูกค้า หรือกด "ลูกค้าใหม่"', true);
          else cid = f.cid;
        }
        const { tot } = totals(), paid = paidNow(tot);
        const note = quick ? '' : [g('f-note').value.trim(), f.chat.trim() ? '[แชท]\n' + f.chat.trim() : ''].filter(Boolean).join('\n\n');
        const shipped = quick || (walkin() && f.shipped);
        const payload = {
          customer_id: cid, new_customer: newC, channel: f.channel, order_date: quick ? st.today : (g('f-od').value || st.today), ship_date: shipped || quick ? '' : g('f-sd').value,
          items, shipping_fee: quick ? 0 : num(g('f-fee').value), discount: num(g('f-disc').value), paid_amount: paid, paid_type: effType(paid, tot) || (quick ? 'payment' : 'payment'), note,
        };
        if (quick) payload.paid_type = 'payment';
        if (shipped) payload.already_shipped = true;
        S.createOrder(payload).then((o) => {
          s.close();
          if (quick) toast('บันทึกการขายแล้ว ' + money(o.total));
          else { toast('บันทึกออเดอร์แล้ว'); import('./ui-orders.js').then((m) => m.openOrder(o.id)); }
        }, (e) => toast(errMsg(e), true));
      };
    },
  });
}

// ---------------------------------------------------------------- edit items
export function openItemsEditor(oid) {
  const S = ctx.store, o0 = findOrder(oid); if (!o0) return;
  const f = { bonus: {}, items: [] };
  (o0.items || []).forEach((i) => {
    const p = i.plant_id && S.getPlant(i.plant_id);
    if (i.plant_id) f.bonus[i.plant_id] = (f.bonus[i.plant_id] || 0) + num(i.qty);
    f.items.push({ plant_id: i.plant_id || '', code: i.code || '', name: i.name, unit_price: num(i.unit_price), qty: num(i.qty), custom: !i.plant_id, max: i.plant_id ? (p ? num(p.qty) : 0) + num(i.qty) : 0 });
  });
  openSheet({
    title: 'แก้ไขรายการสินค้า', sticky: true,
    build(s) {
      s.body.innerHTML = '<div id="x-items"></div><div class="card"><div class="kv mut"><span>รวมสินค้า</span><span id="x-sub"></span></div><div class="kv mut"><span>ค่าส่ง / ส่วนลด</span><span>' + money(o0.shipping_fee) + ' / -' + money(o0.discount) + '</span></div><div class="kv tot"><span>ยอดรวมใหม่</span><span id="x-tot"></span></div><div class="sub right" id="x-diff"></div></div>';
      s.foot.innerHTML = '<button class="btn block" id="x-save">บันทึกรายการสินค้า</button>';
      const calc = () => {
        const sub = sum(f.items, (i) => num(i.unit_price) * i.qty), tot = Math.max(0, sub + num(o0.shipping_fee) - num(o0.discount));
        $('#x-sub', s.body).textContent = money(sub); $('#x-tot', s.body).textContent = money(tot);
        const left = tot - num(o0.paid_amount), d = tot - num(o0.total);
        $('#x-diff', s.body).textContent = (d ? 'ต่างจากเดิม ' + (d > 0 ? '+' : '') + money(d) + ' · ' : '') + (left >= 0 ? 'ค้างชำระ ' + money(left) : 'ต้องคืนเงิน ' + money(-left));
      };
      itemsPicker($('#x-items', s.body), f, calc); calc();
      $('#x-save', s.foot).onclick = () => {
        const items = payloadItems(f);
        if (!items.length) return toast('ต้องมีอย่างน้อย 1 รายการ — ถ้าต้องการยกเลิกทั้งหมดให้ใช้ "ยกเลิกออเดอร์"', true);
        if (items.some((i) => !i.name)) return toast('กรุณาใส่ชื่อรายการที่เพิ่มเอง', true);
        S.updateOrderItems(oid, items).then(() => { s.close(); toast('แก้ไขรายการสินค้าแล้ว'); }, (e) => toast(errMsg(e), true));
      };
    },
  });
}

// ---------------------------------------------------------------- photo import
function plantPickDlg(cb) {
  let q = '';
  const d = dialog('เลือกต้นไม้ในสต็อก', '<div class="search"><span>' + icon('search') + '</span><input id="pp-q" placeholder="ค้นหาชื่อหรือรหัส" autocomplete="off"></div><div class="picklist" id="pp-l" style="max-height:46vh"></div><button class="btn ghost block" data-act="none">ไม่ตรงกับสต็อก / รายการพิเศษ</button>', '', null, { noCancel: true });
  const fill = () => {
    const l = ctx.store.state.plants.filter((p) => num(p.qty) > 0 && (!q || (str(p.name) + ' ' + str(p.code)).toLowerCase().includes(q))).slice(0, 25);
    $('#pp-l', d.el).innerHTML = l.length ? l.map((p) => '<button class="pick" data-act="pk" data-id="' + esc(p.id) + '">' + thumbHTML(p, 'sm') + '<span class="grow"><span class="nm trunc" style="display:block">' + esc(p.name) + '</span><span class="sub">' + esc(p.code) + '</span></span><b class="num">' + money(p.price) + '</b></button>').join('') : '<div class="sub" style="padding:14px;text-align:center">ไม่พบต้นไม้</div>';
  };
  fill();
  $('#pp-q', d.el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); fill(); };
  bind(d.el, { pk: (x) => { const p = ctx.store.getPlant(x.id); d.close(); cb(p || null); }, none: () => { d.close(); cb(null); } });
}

export function startImport() {
  const inp = $('#pick-photo'); inp.value = '';
  inp.onchange = () => { const file = inp.files && inp.files[0]; inp.value = ''; if (file) importPhoto(file); };
  inp.click();
}
function keyDlg() {
  dialog('ยังไม่ได้ใส่ Gemini API key', '<p>การอ่านรูปใช้ Gemini AI ของ Google (ฟรี) ต้องใส่ API key ก่อน</p><p class="sub">1. เปิด aistudio.google.com/apikey ด้วยบัญชี Google<br>2. กด Create API key<br>3. คัดลอกมาวางที่ ตั้งค่า → Gemini API key แล้วกดบันทึก</p>', 'ไปที่ตั้งค่า', () => { import('./ui-core.js').then((m) => { m.closeAllSheets(); ctx.nav.menu('settings'); }); });
}
async function importPhoto(file) {
  const S = ctx.store, set = S.state.settings || {};
  if (!str(set.gemini_api_key).trim()) return keyDlg();
  const end = busy('กำลังอ่านรูป… (ราว 5–15 วินาที)');
  try {
    const gm = await import('./gemini.js');
    const blob = await gm.downscaleImage(file, 1800, 0.85);
    const r = await gm.parseOrderPhoto(blob, { apiKey: set.gemini_api_key, model: set.gemini_model, plants: S.state.plants });
    end();
    if (!r.drafts || !r.drafts.length) return toast('ไม่พบรายการขายในรูป ลองถ่ายให้ชัดขึ้น', true);
    openImportReview(r.drafts);
  } catch (e) {
    end();
    if (/Gemini API key/i.test(errMsg(e))) keyDlg(); else toast(errMsg(e), true);
  }
}
function openImportReview(drafts) {
  const S = ctx.store, st = S.state;
  const normPid = (v) => { v = str(v); if (!v) return ''; const p = st.plants.find((x) => x.id === v) || st.plants.find((x) => x.code === v); return p ? p.id : ''; };
  const R = {
    date: st.today, ds: drafts.map((d) => ({
      inc: true, name: str(d.customer_name), note: str(d.note), paidAuto: d.paid_amount == null, paid: d.paid_amount == null ? 0 : num(d.paid_amount), err: '',
      items: (d.items || []).map((i) => ({ plant_id: normPid(i.plant_id), name: str(i.name) || '?', unit_price: num(i.unit_price), qty: Math.max(1, Math.round(num(i.qty)) || 1) })),
    })),
  };
  const dTot = (d) => sum(d.items, (i) => i.unit_price * i.qty);
  const dPaid = (d) => (d.paidAuto ? dTot(d) : d.paid);
  let curUp = () => {};
  openSheet({
    title: 'นำเข้าจากรูปจดขาย', sticky: true,
    build(s) {
      const B = s.body;
      const cards = R.ds.map((d, di) => {
        const lines = d.items.map((i, ii) => {
          const pl = i.plant_id && S.getPlant(i.plant_id);
          return '<div class="line" style="margin-top:10px"><input data-in="' + di + ':' + ii + '" value="' + esc(i.name) + '" aria-label="ชื่อรายการ">' +
            '<button class="btn sec sm block" style="margin-top:8px" data-act="fix" data-d="' + di + '" data-i="' + ii + '">' + (pl ? icon('check') + ' ตรงกับ ' + esc(pl.code) + ' (แตะเพื่อเปลี่ยน)' : icon('search') + ' ไม่ตรงกับสต็อก — แตะเพื่อเลือกต้นไม้') + '</button>' +
            '<div class="ctl"><div class="pr"><input type="number" inputmode="decimal" data-ip="' + di + ':' + ii + '" value="' + i.unit_price + '" aria-label="ราคาต่อหน่วย"></div><div class="stepper"><button data-act="dec" data-d="' + di + '" data-i="' + ii + '">−</button><b>' + i.qty + '</b><button data-act="inc" data-d="' + di + '" data-i="' + ii + '">+</button></div><button class="xbtn" data-act="rmi" data-d="' + di + '" data-i="' + ii + '" aria-label="ลบรายการ">' + icon('close') + '</button></div></div>';
        }).join('') || '<div class="sub" style="padding:8px 0">ไม่มีรายการ</div>';
        return '<div class="card' + (d.err ? ' bad' : '') + '"><label class="cb"><input type="checkbox" data-inc="' + di + '"' + (d.inc ? ' checked' : '') + '> ออเดอร์ที่ ' + (di + 1) + '</label>' +
          '<label class="fld">ชื่อลูกค้า (เว้นว่าง = ' + WALKIN_NAME + ')</label><input data-dn="' + di + '" value="' + esc(d.name) + '">' + lines +
          '<label class="fld">รับเงินแล้ว (บาท)</label><input type="number" inputmode="decimal" data-dp="' + di + '" value="' + dPaid(d) + '">' +
          '<label class="fld">หมายเหตุ</label><input data-dnote="' + di + '" value="' + esc(d.note) + '">' +
          '<div class="kv tot"><span>ยอดรวม</span><span data-tot="' + di + '">' + money(dTot(d)) + '</span></div>' + (d.err ? '<div class="red" style="margin-top:6px;font-weight:600">' + esc(d.err) + '</div>' : '') + '</div>';
      }).join('');
      B.innerHTML = '<div class="warnbox">' + icon('alert') + '<span>ตรวจทุกบรรทัดก่อนบันทึก — AI อ่านลายมือผิดได้</span></div><div class="card"><label class="fld">วันที่ขาย</label><input type="date" id="r-date" value="' + esc(R.date) + '"></div>' + cards;
      const cnt = R.ds.filter((d) => d.inc).length;
      s.foot.innerHTML = '<button class="btn block" id="r-save"' + (cnt ? '' : ' disabled') + '>บันทึก ' + cnt + ' ออเดอร์</button>';
      const up = (di) => { const t = B.querySelector('[data-tot="' + di + '"]'); if (t) t.textContent = money(dTot(R.ds[di])); if (R.ds[di].paidAuto) { const p = B.querySelector('[data-dp="' + di + '"]'); if (p) p.value = dTot(R.ds[di]); } };
      if (!s.bound) {
        s.bound = true;
        bind(B, {
          fix: (d) => { const it = R.ds[+d.d].items[+d.i]; plantPickDlg((p) => { if (p) { it.plant_id = p.id; it.name = p.name; if (!it.unit_price) it.unit_price = num(p.price); } else it.plant_id = ''; s.render(); }); },
          inc: (d) => { R.ds[+d.d].items[+d.i].qty++; s.render(); },
          dec: (d) => { const it = R.ds[+d.d].items[+d.i]; if (it.qty > 1) { it.qty--; s.render(); } },
          rmi: (d) => { R.ds[+d.d].items.splice(+d.i, 1); s.render(); },
        });
        B.addEventListener('input', (e) => {
          const t = e.target; let k;
          if ((k = t.dataset.in) !== undefined) { const a = k.split(':'); R.ds[+a[0]].items[+a[1]].name = t.value; }
          else if ((k = t.dataset.ip) !== undefined) { const b = k.split(':'); R.ds[+b[0]].items[+b[1]].unit_price = num(t.value); curUp(+b[0]); }
          else if ((k = t.dataset.dn) !== undefined) R.ds[+k].name = t.value;
          else if ((k = t.dataset.dnote) !== undefined) R.ds[+k].note = t.value;
          else if ((k = t.dataset.dp) !== undefined) { R.ds[+k].paidAuto = false; R.ds[+k].paid = num(t.value); }
          else if (t.id === 'r-date') R.date = t.value;
        });
        B.addEventListener('change', (e) => {
          const k = e.target.dataset.inc; if (k === undefined) return;
          R.ds[+k].inc = e.target.checked; const c = R.ds.filter((d) => d.inc).length;
          const sb = $('#r-save', s.foot); sb.textContent = 'บันทึก ' + c + ' ออเดอร์'; sb.disabled = !c;
        });
      }
      curUp = up;
      $('#r-save', s.foot).onclick = () => {
        const sel = R.ds.filter((d) => d.inc); let bad = false;
        sel.forEach((d) => { d.err = ''; if (!d.items.length) { d.err = 'ไม่มีรายการสินค้า'; bad = true; } else if (d.items.some((i) => !str(i.name).trim())) { d.err = 'มีรายการที่ไม่มีชื่อ'; bad = true; } });
        if (bad) { toast('มีออเดอร์ที่ข้อมูลไม่ครบ', true); s.render(); return; }
        const payloads = sel.map((d) => {
          const tot = dTot(d), paid = dPaid(d), nm = d.name.trim(), cname = nm || WALKIN_NAME;
          const ex = st.customers.find((c) => c.name.trim().toLowerCase() === cname.toLowerCase());
          return {
            customer_id: ex ? ex.id : '', new_customer: ex ? null : { name: cname, channel: 'walkin', contact: '', country: '', address: '', note: '' }, channel: 'walkin', order_date: R.date || st.today, ship_date: '', already_shipped: true, shipping_fee: 0, discount: 0,
            paid_amount: paid, paid_type: paid > 0 && paid < tot ? 'deposit' : 'payment', note: d.note.trim(), items: d.items.map((i) => ({ plant_id: i.plant_id, name: i.name.trim(), unit_price: i.unit_price, qty: i.qty })),
          };
        });
        S.createOrdersBatch(payloads).then((r) => {
          const errs = {}; ((r && r.errors) || []).forEach((x) => { errs[x.index] = x.message; });
          const okDs = []; sel.forEach((d, i) => { if (errs[i] !== undefined) d.err = str(errs[i]); else okDs.push(d); });
          R.ds = R.ds.filter((d) => okDs.indexOf(d) < 0);
          if (!R.ds.length) { s.close(); toast('บันทึก ' + okDs.length + ' ออเดอร์แล้ว'); ctx.nav.orders('all'); }
          else { toast('บันทึกแล้ว ' + okDs.length + ' · ไม่สำเร็จ ' + R.ds.length + ' (แก้ไขแล้วลองใหม่)', true); s.render(); }
        }, (e) => toast(errMsg(e), true));
      };
    },
  });
}
