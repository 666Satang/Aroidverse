// Photos on custom order lines (SPEC9 §2): slot, pick → crop, options dialog, viewer.
import { ctx, $, esc, icon, toast, errMsg, openSheet, dialog, confirmDlg, bind } from './ui-core.js';
import { openCropper, showCropped } from './ui-crop.js';

// File picker that must be opened synchronously inside the tap. Resolves null when nothing was chosen.
export function pickFile() {
  return new Promise((resolve) => {
    const inp = $('#pick-photo'); inp.value = '';
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; resolve(f || null); };
    inp.click();
  });
}
// pick → cropper. Resolves {thumb, full, crop} or null. Call synchronously from a tap handler.
export async function chooseAndCrop() {
  const f = await pickFile(); if (!f) return null;
  return openCropper(f, { title: 'ครอปรูปรายการ' });
}
export function getDoc(photoId) {
  const S = ctx.store;
  return S.getItemPhotoDoc ? S.getItemPhotoDoc(photoId).catch(() => null) : Promise.resolve(null);
}
// re-crop a saved/staged image. src = data URL. Resolves {thumb, crop} or null
export const recrop = (src, crop) => openCropper(src, { title: 'ครอปรูปใหม่', crop });

export function slotHTML(thumb, attrs, label) {
  return '<button type="button" class="pslot' + (thumb ? ' has' : '') + '" ' + attrs + ' aria-label="' + esc(label || 'รูปรายการ') + '">' + (thumb ? '<img alt="" decoding="async" src="' + esc(thumb) + '">' : icon('camera')) + '</button>';
}

// viewer: cropped view, tap for the original. acts = {recrop, change, remove} (optional; shown in the footer)
export function openViewer(title, load, thumb, acts) {
  const s = openSheet({
    title: title || 'รูป',
    build(sh) {
      sh.body.innerHTML = '<div class="inv-wrap" style="min-height:240px">' + (thumb ? '<img alt="" src="' + esc(thumb) + '" style="width:100%;filter:blur(2px)">' : '') + '</div>';
      sh.foot.innerHTML = acts ? '<button class="btn ghost sm" data-v="recrop">ครอปใหม่</button><button class="btn ghost sm" data-v="change">เปลี่ยนรูป</button><button class="btn warn sm" data-v="remove">ลบรูป</button>' : '';
    },
  });
  if (acts) s.foot.onclick = (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const k = b.dataset.v;
    if (k === 'change') { const p = chooseAndCrop(); s.close(); acts.change(p); } // file dialog opens synchronously above
    else { s.close(); acts[k](); }
  };
  load().then((doc) => {
    if (s.closed) return;
    const w = $('.inv-wrap', s.body);
    if (doc && doc.data) { w.style.minHeight = '0'; return showCropped(w, doc.data, doc.crop, title); }
    w.innerHTML = thumb ? '<img alt="" src="' + esc(thumb) + '" style="width:100%">' : '<div class="empty"><p>ไม่พบรูป</p></div>';
  }).catch(() => {});
  return s;
}

// options dialog for a slot in a form: ดูรูป / ครอปใหม่ / เปลี่ยนรูป / ลบรูป. h = {view, recrop, change(promise), remove}
export function optionsDialog(h) {
  const d = dialog('รูปรายการ', '<div class="photoopts"><button class="btn ghost block" data-po="view">' + icon('eye') + ' ดูรูป</button><button class="btn ghost block" data-po="recrop">' + icon('edit') + ' ครอปใหม่</button><button class="btn ghost block" data-po="change">' + icon('camera') + ' เปลี่ยนรูป</button><button class="btn warn block" data-po="remove">' + icon('trash') + ' ลบรูป</button></div>', '', null, { noCancel: true });
  d.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-po]'); if (!b) return;
    const k = b.dataset.po;
    if (k === 'change') { const p = chooseAndCrop(); d.close(); h.change(p); }
    else { d.close(); h[k](); }
  });
  return d;
}

// detail page: set / replace / recrop / remove on a saved order line (indexes into order.items)
export function detailActions(orderId, idx) {
  const S = ctx.store;
  const done = (msg) => () => toast(msg);
  const fail = (e) => toast(errMsg(e), true);
  const set = (photo, msg) => S.setItemPhoto(orderId, idx, photo).then(done(msg), fail);
  return {
    add: () => { chooseAndCrop().then((r) => r && set(r, 'บันทึกรูปแล้ว')); },
    change: (p) => { p.then((r) => r && set(r, 'เปลี่ยนรูปแล้ว')); },
    recrop: async () => {
      const o = ctx.store.getOrder(orderId) || ctx.extra.get(orderId), it = o && o.items && o.items[idx]; if (!it || !it.photo_id) return;
      const doc = await getDoc(it.photo_id); if (!doc || !doc.data) return toast('ไม่พบรูปต้นฉบับ — ใช้ "เปลี่ยนรูป" แทน', true);
      const r = await recrop(doc.data, doc.crop); if (r) set({ thumb: r.thumb, crop: r.crop }, 'ครอปรูปใหม่แล้ว');
    },
    remove: () => confirmDlg('ลบรูปรายการนี้?', 'รูปจะถูกลบออกจากออเดอร์', 'ลบรูป', () => S.setItemPhoto(orderId, idx, false).then(done('ลบรูปแล้ว'))),
  };
}
export function openDetailViewer(o, idx) {
  const it = o.items[idx]; if (!it) return;
  const act = o.status !== 'cancelled', a = detailActions(o.id, idx);
  return openViewer(it.name || 'รูป', () => getDoc(it.photo_id), it.thumb, act ? { recrop: a.recrop, change: a.change, remove: a.remove } : null);
}
