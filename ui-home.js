// Home dashboard.
import { ctx, $, esc, num, str, money, icon, bind, DAYS, MONTHS, isActive, balanceOf, emptyHTML } from './ui-core.js';
import { orderCard, openOrder } from './ui-orders.js';

function greeting() {
  const h = +new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }) % 24;
  return h < 11 ? 'สวัสดีตอนเช้า' : h < 16 ? 'สวัสดีตอนบ่าย' : h < 19 ? 'สวัสดีตอนเย็น' : 'สวัสดีตอนค่ำ';
}
function dateLine(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return 'วัน' + DAYS[d.getDay()] + 'ที่ ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
}

export const homeView = {
  mount(el) {
    bind(el, {
      f: (d) => ctx.nav.orders(d.f),
      order: (d) => openOrder(d.id),
      neworder: () => import('./ui-form.js').then((m) => m.openOrderForm()),
    });
    this.update(el);
  },
  update(el) {
    const S = ctx.store, st = S.state, ms = S.monthStats(st.today.slice(0, 7));
    const act = st.orders.filter(isActive);
    const soon = act.filter((o) => o.ship_status === 'pending').sort((a, b) => { const x = str(a.ship_date), y = str(b.ship_date); if (!x && !y) return 0; if (!x) return 1; if (!y) return -1; return x < y ? -1 : x > y ? 1 : 0; }).slice(0, 5);
    const owe = act.filter((o) => o.payment_status !== 'paid' && balanceOf(o) > 0.005).sort((a, b) => (str(a.order_date) < str(b.order_date) ? -1 : 1)).slice(0, 5);
    const card = (cls, f, t, v, s) => '<button class="stat-c ' + cls + '" data-act="f" data-f="' + f + '"><div class="t"><i></i>' + t + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></button>';
    const none = (t) => '<div class="card flat sub" style="text-align:center;padding:20px">' + t + '</div>';
    el.innerHTML =
      '<div class="hello"><h1>' + greeting() + '</h1><p>' + esc(dateLine(st.today)) + '</p></div>' +
      '<button class="hero" data-act="f" data-f="unpaid">' + icon('leaf', 'leaf') + '<div class="lbl">ยอดค้างชำระรวม</div><div class="big">' + esc(money(ms.outstanding_all)) + '</div><div class="cnt">' + (ms.outstanding_count ? ms.outstanding_count + ' ออเดอร์ที่ยังรอรับเงิน' : 'ไม่มียอดค้าง เยี่ยมเลย') + '</div></button>' +
      '<div class="stats">' +
      card('sky', 'pending', 'รอส่ง', ms.to_ship, 'ออเดอร์') +
      card('mint', 'today', 'ส่งวันนี้', ms.ship_today, 'ออเดอร์') +
      card('rose' + (ms.overdue ? ' hot' : ''), 'over', 'เลยกำหนด', ms.overdue, 'ออเดอร์') +
      card('peach', 'month', 'ยอดขายเดือนนี้', esc(money(ms.sales)), 'รับเงินแล้ว ' + esc(money(ms.received))) + '</div>' +
      '<div><div class="sec-h"><span>ต้องส่งเร็วๆ นี้</span><button class="link" data-act="f" data-f="pending">ดูทั้งหมด</button></div>' +
      (soon.length ? '<div class="list">' + soon.map(orderCard).join('') + '</div>' : (st.orders.length ? none('ไม่มีออเดอร์ที่รอส่ง') : emptyHTML('🌱', 'ยังไม่มีออเดอร์', 'เริ่มจากออเดอร์แรกของคุณ', 'ออเดอร์ใหม่', 'neworder'))) + '</div>' +
      (owe.length ? '<div><div class="sec-h"><span>รอชำระ</span><button class="link" data-act="f" data-f="unpaid">ดูทั้งหมด</button></div><div class="list">' + owe.map(orderCard).join('') + '</div></div>' : '');
  },
};
