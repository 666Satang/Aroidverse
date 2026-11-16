// Other expenses (SPEC8): month list, add/edit sheet, copy recurring items from last month.
import { ctx, $, esc, num, str, sum, money, fmtDate, MONTHS, DAYS, icon, toast, openSheet, confirmDlg, bind, errMsg, emptyHTML, pill, numOrNull } from './ui-core.js';

let ym = null;
const loaded = {}; // ym -> list returned by loadExpenses (fallback when the store state does not hold that month)
const gone = new Set();
const ymAdd = (v, d) => { let y = +v.slice(0, 4), m = +v.slice(5, 7) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };
const ymLabel = (v) => MONTHS[+v.slice(5, 7) - 1] + ' ' + v.slice(0, 4);
const daysIn = (v) => new Date(+v.slice(0, 4), +v.slice(5, 7), 0).getDate();
const TONES = ['mint', 'sky', 'peach', 'lilac', 'butter', 'rose'];
const toneOf = (c) => { const i = ['ค่าที่', 'วัสดุสิ้นเปลือง', 'ค่าขนส่ง', 'ค่าการตลาด', 'ค่าแรง', 'อื่นๆ'].indexOf(c); if (i >= 0) return TONES[i]; let h = 0; for (let k = 0; k < c.length; k++) h = (h * 31 + c.charCodeAt(k)) >>> 0; return TONES[h % TONES.length]; };

// rows of a month: store state first (live), plus anything loaded for that month that state does not hold
export function rowsOf(v) {
  const st = ctx.store.state.expenses || [], seen = new Set(), out = [];
  st.forEach((e) => { if (!e.deleted && str(e.ym || e.date.slice(0, 7)) === v) { seen.add(e.id); out.push(e); } });
  (loaded[v] || []).forEach((e) => { if (!e.deleted && !seen.has(e.id) && !gone.has(e.id) && str(e.date).slice(0, 7) === v) out.push(e); });
  return out.sort((a, b) => (str(a.date) < str(b.date) ? 1 : str(a.date) > str(b.date) ? -1 : str(b.created_at) < str(a.created_at) ? -1 : 1));
}
function fetchMonth(v, cb) {
  ctx.store.loadExpenses(v).then((l) => { loaded[v] = l || []; cb(); }, (e) => toast(errMsg(e), true));
}

export const expensesView = {
  mount(el) {
    const S = ctx.store, cur = S.state.today.slice(0, 7);
    ym = ctx.ui.expYm || cur; ctx.ui.expYm = null;
    const go = (d) => { ym = ymAdd(ym, d); this.update(el); if (ym !== cur) fetchMonth(ym, () => { if (el.isConnected) this.update(el); }); };
    bind(el, {
      prev: () => go(-1), next: () => { if (ym < cur) go(1); },
      add: () => openExpenseForm({ ym }),
      edit: (d) => openExpenseForm({ id: d.id, ym }),
      copy: () => openCopySheet(ym),
    });
    this.update(el);
    if (ym !== cur) fetchMonth(ym, () => { if (el.isConnected) this.update(el); });
  },
  update(el) {
    const cur = ctx.store.state.today.slice(0, 7), rows = rowsOf(ym), total = sum(rows, (e) => e.amount);
    const groups = [];
    rows.forEach((e) => { const g = groups[groups.length - 1]; if (g && g.date === e.date) g.items.push(e); else groups.push({ date: e.date, items: [e] }); });
    const dow = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? 'วัน' + DAYS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : ''; };
    el.innerHTML = '<div class="yr"><button data-act="prev" aria-label="เดือนก่อนหน้า">' + icon('left') + '</button><b style="min-width:150px">' + esc(ymLabel(ym)) + '</b><button data-act="next" aria-label="เดือนถัดไป"' + (ym >= cur ? ' disabled' : '') + '>' + icon('right') + '</button></div>' +
      '<div class="stat-c peach wide" style="margin-top:14px"><div class="t"><i></i>ค่าใช้จ่ายรวม</div><div class="v">' + esc(money(total)) + '</div><div class="s">' + rows.length + ' รายการ</div></div>' +
      '<div class="grid2" style="margin-top:12px"><button class="btn" data-act="add">' + icon('plus') + ' เพิ่มค่าใช้จ่าย</button><button class="btn sec" data-act="copy">คัดลอกจากเดือนก่อน</button></div>' +
      (groups.length ? groups.map((g) => '<div class="exgrp"><div class="sec-h" style="margin-top:18px;font-size:14.5px;color:var(--muted)"><span>' + esc(fmtDate(g.date, true)) + ' · ' + dow(g.date) + '</span><span class="num">' + esc(money(sum(g.items, (e) => e.amount))) + '</span></div><div class="menu-list">' +
        g.items.map((e) => '<button class="mrow exrow" data-act="edit" data-id="' + esc(e.id) + '"><span class="grow"><span style="display:block">' + pill(toneOf(str(e.category)), str(e.category) || 'อื่นๆ') + '</span>' + (e.note ? '<span class="sub trunc" style="display:block;margin-top:4px">' + esc(e.note) + '</span>' : '') + '</span><b class="num">' + esc(money(e.amount)) + '</b></button>').join('') + '</div></div>').join('')
        : '<div style="margin-top:10px">' + emptyHTML('🧾', 'ยังไม่มีค่าใช้จ่ายใน' + MONTHS[+ym.slice(5, 7) - 1], 'บันทึกค่าที่ ค่าวัสดุ ค่าขนส่ง ฯลฯ เพื่อดูกำไรสุทธิ', '', '') + '</div>');
  },
};

export function openExpenseForm(opt) {
  opt = opt || {};
  const S = ctx.store, e0 = opt.id ? rowsOf(opt.ym || S.state.today.slice(0, 7)).concat(S.state.expenses || []).find((e) => e.id === opt.id) : null;
  if (opt.id && !e0) return;
  const e = e0 || { date: S.state.today, category: '', amount: '', note: '' };
  openSheet({
    title: e0 ? 'แก้ไขค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย', sticky: true,
    build(s) {
      const B = s.body, cats = S.expenseCategories();
      B.innerHTML = '<div class="card"><label class="fld">วันที่</label><input type="date" id="x-date" value="' + esc(e.date) + '">' +
        '<label class="fld">หมวดหมู่</label><div class="chips wrapchips" id="x-chips">' + cats.map((c) => '<button type="button" class="chip" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
        '<input id="x-cat" placeholder="หรือพิมพ์หมวดหมู่เอง" value="' + esc(e.category) + '" autocomplete="off" style="margin-top:10px">' +
        '<label class="fld">จำนวนเงิน (บาท) *</label><input type="number" inputmode="decimal" id="x-amt" value="' + esc(e.amount) + '" placeholder="0">' +
        '<label class="fld">หมายเหตุ</label><input id="x-note" value="' + esc(e.note) + '" autocomplete="off" placeholder="เช่น ค่าเช่าที่ตลาด"></div>' +
        (e0 ? '<button class="btn warn block" id="x-del">' + icon('trash') + ' ลบรายการนี้</button>' : '');
      s.foot.innerHTML = '<button class="btn block" id="x-save">บันทึก</button>';
      const cat = $('#x-cat', B), paint = () => B.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === cat.value.trim()));
      $('#x-chips', B).onclick = (ev) => { const b = ev.target.closest('[data-cat]'); if (!b) return; cat.value = b.dataset.cat; paint(); };
      cat.addEventListener('input', paint); paint();
      const del = $('#x-del', B);
      if (del) del.onclick = () => confirmDlg('ลบค่าใช้จ่ายนี้?', (e.category || 'อื่นๆ') + ' ' + money(e.amount) + ' — ลบแล้วกำไรสุทธิจะถูกคำนวณใหม่', 'ลบ', () => { gone.add(e.id); return S.deleteExpense(e.id).then(() => { s.close(); toast('ลบค่าใช้จ่ายแล้ว'); }); });
      $('#x-save', s.foot).onclick = () => {
        const amt = numOrNull($('#x-amt', B).value);
        if (amt == null || !(amt > 0)) return toast('กรุณาใส่จำนวนเงินมากกว่า 0', true);
        const rec = { date: $('#x-date', B).value || S.state.today, category: cat.value.trim() || 'อื่นๆ', amount: amt, note: $('#x-note', B).value.trim() };
        if (e0) rec.id = e0.id;
        S.saveExpense(rec).then(() => { s.close(); toast(e0 ? 'บันทึกแล้ว' : 'บันทึกค่าใช้จ่ายแล้ว'); }, (er) => toast(errMsg(er), true));
      };
    },
  });
}

// copy last month's (recurring) expenses into the viewed month, same day-of-month clamped to the month length
function openCopySheet(target) {
  const S = ctx.store, from = ymAdd(target, -1), last = daysIn(target);
  const s = openSheet({ title: 'คัดลอกจาก' + MONTHS[+from.slice(5, 7) - 1], sticky: true, build(sh) { sh.body.innerHTML = '<div class="more" style="padding:40px"><span class="spin"></span></div>'; } });
  S.loadExpenses(from).then((list) => {
    if (s.closed) return;
    loaded[from] = list || [];
    const src = rowsOf(from);
    if (!src.length) { s.body.innerHTML = emptyHTML('🧾', 'เดือนก่อนไม่มีค่าใช้จ่าย', '', '', ''); return; }
    const here = rowsOf(target), key = (x) => [x.category, num(x.amount), str(x.note)].join('|'), have = new Set(here.map(key));
    const items = src.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => { const d = Math.min(+x.date.slice(8, 10), last); return { x, date: target + '-' + String(d).padStart(2, '0'), dup: have.has(key(x)), on: !have.has(key(x)) }; });
    const draw = () => {
      const n = items.filter((i) => i.on).length;
      s.body.innerHTML = '<p class="sub" style="margin:0 2px 10px">เลือกรายการประจำที่จะคัดลอกมาเป็นเดือน ' + esc(ymLabel(target)) + ' (วันที่เดียวกับเดือนก่อน)</p><div class="card" style="padding:6px 14px">' + items.map((i, ix) =>
        '<label class="cb cprow"><input type="checkbox" data-ci="' + ix + '"' + (i.on ? ' checked' : '') + '><span class="grow"><span style="display:block;font-weight:600">' + esc(i.x.category || 'อื่นๆ') + (i.x.note ? ' · ' + esc(i.x.note) : '') + '</span><span class="sub">' + esc(fmtDate(i.date, true)) + (i.dup ? ' · มีรายการนี้อยู่แล้ว' : '') + '</span></span><b class="num">' + esc(money(i.x.amount)) + '</b></label>').join('') + '</div>';
      s.foot.innerHTML = '<button class="btn block" id="cp-go"' + (n ? '' : ' disabled') + '>คัดลอก ' + n + ' รายการ · ' + esc(money(sum(items.filter((i) => i.on), (i) => i.x.amount))) + '</button>';
      s.foot.hidden = false;
      $('#cp-go', s.foot).onclick = () => {
        const pick = items.filter((i) => i.on); if (!pick.length) return;
        Promise.all(pick.map((i) => S.saveExpense({ date: i.date, category: i.x.category, amount: i.x.amount, note: i.x.note }))).then(() => { s.close(); toast('คัดลอกแล้ว ' + pick.length + ' รายการ'); }, (er) => toast(errMsg(er), true));
      };
    };
    draw();
    s.body.addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.ci !== undefined) { items[+t.dataset.ci].on = t.checked; const sc = s.body.scrollTop; draw(); s.body.scrollTop = sc; } });
  }, (e) => { if (!s.closed) s.body.innerHTML = '<div class="empty"><div class="t">โหลดไม่สำเร็จ</div><p>' + esc(errMsg(e)) + '</p></div>'; });
}
