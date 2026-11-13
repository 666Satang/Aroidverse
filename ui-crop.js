// Photo cropper sheet (pointer events: drag to pan, pinch / wheel / slider to zoom) + cropped-photo display helpers.
// crop = {x, y, size}: square side = size * min(w,h); x,y = top-left as fractions of (w - side) / (h - side). Missing crop = {x:.5, y:.5, size:1}.
import { $, esc, toast, openSheet } from './ui-core.js';

const MAX_SIDE = 800, THUMB = 96, THUMB_MAX_CHARS = 8000, ZMAX = 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

export function normCrop(c) {
  if (!c || typeof c !== 'object') return { x: 0.5, y: 0.5, size: 1 };
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  return { x: clamp(n(c.x, 0.5), 0, 1), y: clamp(n(c.y, 0.5), 0, 1), size: clamp(n(c.size, 1), 1 / ZMAX, 1) };
}

// CSS (width/left/top in %) that shows the cropped square of an image w x h inside a square overflow:hidden box.
export function cropStyle(w, h, crop) {
  const c = normCrop(crop), side = c.size * Math.min(w, h);
  return 'position:absolute;max-width:none;width:' + r4(w / side * 100) + '%;left:' + r4(-(c.x * (w - side)) / side * 100) + '%;top:' + r4(-(c.y * (h - side)) / side * 100) + '%';
}

// Renders url into host as a cropped square; tapping toggles the uncropped original. Returns a promise (resolves when laid out).
export function showCropped(host, url, crop, alt) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) return resolve();
      host.innerHTML = '<div class="cropbox" role="button" tabindex="0" aria-label="แตะเพื่อดูรูปเต็ม"><img alt="' + esc(alt || '') + '" src="' + esc(url) + '" style="' + cropStyle(w, h, crop) + '"></div><div class="cropnote">แตะรูปเพื่อดูรูปเต็ม</div>';
      const box = $('.cropbox', host), note = $('.cropnote', host); let full = false;
      const toggle = () => {
        full = !full;
        box.classList.toggle('full', full);
        box.style.aspectRatio = full ? w + ' / ' + h : '';
        $('img', box).style.cssText = full ? 'width:100%;height:100%;object-fit:contain;display:block' : cropStyle(w, h, crop);
        note.textContent = full ? 'แตะอีกครั้งเพื่อกลับไปดูแบบครอป' : 'แตะรูปเพื่อดูรูปเต็ม';
      };
      box.onclick = toggle; box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      resolve();
    };
    im.onerror = () => resolve();
    im.src = url;
  });
}

// ---------- decoding ----------
function fitCanvas(srcW, srcH, draw) {
  const k = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(srcW * k)); c.height = Math.max(1, Math.round(srcH * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high'; draw(g, c.width, c.height);
  return c;
}
function loadImg(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; }); }
export async function decodeToCanvas(source) {
  if (typeof source === 'string') {
    const im = await loadImg(source);
    return fitCanvas(im.naturalWidth, im.naturalHeight, (g, w, h) => g.drawImage(im, 0, 0, w, h));
  }
  if (window.createImageBitmap) {
    try {
      const bm = await createImageBitmap(source, { imageOrientation: 'from-image' });
      const c = fitCanvas(bm.width, bm.height, (g, w, h) => g.drawImage(bm, 0, 0, w, h));
      if (bm.close) bm.close();
      return c;
    } catch (e) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(source);
  try {
    const im = await loadImg(url);
    return fitCanvas(im.naturalWidth, im.naturalHeight, (g, w, h) => g.drawImage(im, 0, 0, w, h));
  } finally { URL.revokeObjectURL(url); }
}

// 96px square JPEG from the crop; step down in halves for quality, lower JPEG quality until small enough.
export function makeThumb(base, crop) {
  const c = normCrop(crop), w = base.width, h = base.height, side = c.size * Math.min(w, h);
  let src = base, sx = c.x * (w - side), sy = c.y * (h - side), sw = side;
  while (sw / 2 >= THUMB) {
    const half = document.createElement('canvas'); half.width = half.height = Math.round(sw / 2);
    const g = half.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, half.width, half.height);
    g.drawImage(src, sx, sy, sw, sw, 0, 0, half.width, half.height);
    src = half; sx = 0; sy = 0; sw = half.width;
  }
  const out = document.createElement('canvas'); out.width = out.height = THUMB;
  const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, THUMB, THUMB);
  g.drawImage(src, sx, sy, sw, sw, 0, 0, THUMB, THUMB);
  let u = '';
  for (const q of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) { u = out.toDataURL('image/jpeg', q); if (u.length <= THUMB_MAX_CHARS) break; }
  return u;
}

// ---------- cropper sheet ----------
// source: File/Blob (new image → result has `full`) or data-URL string (re-crop → no `full`).
// Resolves {full?, crop, thumb} or null when cancelled.
export function openCropper(source, opt) {
  opt = opt || {};
  return new Promise((resolve) => {
    let done = false, base = null;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const sheet = openSheet({
      title: opt.title || 'ครอปรูป', sticky: true, onClose: () => finish(null),
      build(s) {
        if (s.built) return; s.built = true;
        s.body.innerHTML = '<div class="cropstage" id="cr-stage"><div class="more" style="padding:0"><span class="spin"></span></div></div>' +
          '<div class="cropzoom"><span class="sub">ซูม</span><input type="range" id="cr-zoom" min="1" max="' + ZMAX + '" step="0.01" value="1" aria-label="ซูมรูป"></div>' +
          '<p class="sub" style="text-align:center;margin-top:8px">ลากเพื่อเลื่อน · ใช้สองนิ้วหรือแถบซูมเพื่อขยาย</p>';
        s.foot.innerHTML = '<button class="btn ghost" data-x="c">ยกเลิก</button><button class="btn" data-x="ok" disabled>ใช้รูปนี้</button>';
      },
    });
    const stage = $('#cr-stage', sheet.body), zoom = $('#cr-zoom', sheet.body), ok = $('[data-x="ok"]', sheet.foot);
    sheet.foot.onclick = (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'c') return sheet.close();
      if (!base || ok.disabled) return;
      ok.disabled = true;
      const crop = getCrop();
      const res = { crop, thumb: makeThumb(base, crop) };
      if (typeof source !== 'string') res.full = base.toDataURL('image/jpeg', 0.75);
      finish(res); sheet.close();
    };

    let cv = null, W = 0, H = 0, S = 300, z = 1, cx = 0, cy = 0, raf = 0;
    const scale = () => (S / Math.min(W, H)) * z;
    function clampC() {
      const side = Math.min(W, H) / z;
      cx = clamp(cx, side / 2, Math.max(side / 2, W - side / 2)); cy = clamp(cy, side / 2, Math.max(side / 2, H - side / 2));
    }
    function paint() {
      raf = 0; if (!cv) return;
      S = stage.clientWidth || S; clampC();
      const s = scale();
      cv.style.transform = 'translate3d(' + (S / 2 - cx * s) + 'px,' + (S / 2 - cy * s) + 'px,0) scale(' + s + ')';
      if (+zoom.value !== z) zoom.value = z;
    }
    const sched = () => { if (!raf) raf = requestAnimationFrame(paint); };
    function getCrop() {
      const side = Math.min(W, H) / z, left = cx - side / 2, top = cy - side / 2;
      return { x: r4(W - side > 0.5 ? clamp(left / (W - side), 0, 1) : 0.5), y: r4(H - side > 0.5 ? clamp(top / (H - side), 0, 1) : 0.5), size: r4(1 / z) };
    }
    // zoom to nz keeping the stage point (mx,my) fixed
    function zoomAt(nz, mx, my) {
      nz = clamp(nz, 1, ZMAX); const s0 = scale();
      const ix = cx + (mx - S / 2) / s0, iy = cy + (my - S / 2) / s0;
      z = nz; const s1 = scale();
      cx = ix - (mx - S / 2) / s1; cy = iy - (my - S / 2) / s1;
      sched();
    }

    function bindStage() {
      const pts = new Map(); let lastDist = 0, lastMid = null;
      const mid = () => { const a = Array.from(pts.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
      const rel = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      stage.addEventListener('pointerdown', (e) => {
        try { stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) { const m = mid(); lastDist = m.d; lastMid = m; }
        e.preventDefault();
      });
      stage.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId); if (!p) return;
        if (pts.size === 1) {
          const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
          const s = scale(); cx -= dx / s; cy -= dy / s; sched();
        } else if (pts.size >= 2) {
          p.x = e.clientX; p.y = e.clientY;
          const m = mid(), r = stage.getBoundingClientRect();
          if (lastDist > 0 && m.d > 0) zoomAt(z * (m.d / lastDist), m.x - r.left, m.y - r.top);
          if (lastMid) { const s = scale(); cx -= (m.x - lastMid.x) / s; cy -= (m.y - lastMid.y) / s; }
          lastDist = m.d; lastMid = m; sched();
        }
        e.preventDefault();
      });
      const up = (e) => {
        pts.delete(e.pointerId); lastMid = null; lastDist = 0;
        if (pts.size === 2) { const m = mid(); lastDist = m.d; lastMid = m; }
      };
      stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = rel(e); zoomAt(z * Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
      zoom.addEventListener('input', () => zoomAt(+zoom.value, S / 2, S / 2));
      window.addEventListener('resize', sched);
      const orig = sheet.close; // remove the resize listener on close
      sheet.close = () => { window.removeEventListener('resize', sched); orig(); };
    }

    decodeToCanvas(source).then((c) => {
      if (done || sheet.closed) return;
      base = c; W = c.width; H = c.height;
      const k = normCrop(opt.crop);
      z = 1 / k.size; const side = Math.min(W, H) / z;
      cx = k.x * (W - side) + side / 2; cy = k.y * (H - side) + side / 2;
      cv = c; cv.className = 'cropcv'; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      stage.innerHTML = ''; stage.appendChild(cv);
      const g = document.createElement('div'); g.className = 'cropgrid'; stage.appendChild(g);
      stage.classList.add('ready'); S = stage.clientWidth || S;
      bindStage(); zoom.value = z; paint(); ok.disabled = false;
    }, () => { toast('อ่านรูปไม่สำเร็จ', true); sheet.close(); });
  });
}
