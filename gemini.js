// gemini.js — อ่านรูปจดขายด้วย Gemini (เรียกจากเบราว์เซอร์โดยตรง) + ตัวช่วยย่อรูป
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_MODEL = 'gemini-flash-latest';

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
function num(v, dflt) {
  if (typeof v === 'number') return isFinite(v) ? v : dflt;
  if (typeof v === 'string') {
    let s = v.trim().replace(/[,฿\s]|thb|บาท/gi, '');
    let mult = 1;
    if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); }
    const n = parseFloat(s);
    return isFinite(n) && s !== '' ? n * mult : dflt;
  }
  return dflt;
}
const round2 = (n) => Math.round(n * 100) / 100;

function parseJsonLoose(s) {
  const t = String(s).trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* try slicing */ }
  let a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* ignore */ } }
  a = t.indexOf('['); b = t.lastIndexOf(']');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* ignore */ } }
  return null;
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    r.readAsDataURL(blob);
  });
}

async function loadBitmap(src) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    try { return await createImageBitmap(src); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(src);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('เปิดรูปไม่สำเร็จ'));
      img.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

// ย่อรูปให้ด้านยาวสุด <= maxSide แล้วแปลงเป็น JPEG (พื้นขาว) -> Blob
export async function downscaleImage(fileOrBlob, maxSide = 1600, quality = 0.8) {
  const bmp = await loadBitmap(fileOrBlob);
  const w0 = bmp.naturalWidth || bmp.width, h0 = bmp.naturalHeight || bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), 'image/jpeg', quality);
  });
}

// รูปต้นไม้: thumb 96px (เล็ก ≤ ~6KB) และ full 640px เป็น data-URL
export async function makePlantPhoto(file) {
  const fullBlob = await downscaleImage(file, 640, 0.7);
  let thumbBlob = await downscaleImage(file, 96, 0.7);
  for (const q of [0.6, 0.5, 0.4]) {
    if (thumbBlob.size <= 6000) break;
    thumbBlob = await downscaleImage(file, 96, q);
  }
  return { thumb: await blobToDataURL(thumbBlob), full: await blobToDataURL(fullBlob) };
}

function buildPrompt(plants) {
  const list = (Array.isArray(plants) ? plants : []).filter(Boolean);
  const ordered = list.filter((p) => p.qty > 0).concat(list.filter((p) => !(p.qty > 0))).slice(0, 300);
  const stock = ordered.map((p) => (p.code || p.id) + ' | ' + str(p.name).replace(/\s*\|\s*/g, ' / ').replace(/\s+/g, ' ') + ' | ' + p.price).join('\n');
  return 'The image is a handwritten daily sales note from a rare-plant shop in Thailand (Thai and/or English text, ' +
    'prices in Thai baht (THB); "k" means thousand, e.g. 2.5k = 2500). Each line or block of text is one sale. ' +
    'Return ONLY JSON in exactly this shape: ' +
    '{"orders":[{"customer_name":string,"items":[{"plant_id":string,"name":string,"unit_price":number,"qty":number}],"paid_amount":number|null,"note":string}]}. ' +
    'Match items to the stock list below (format: plant_id | name | list price; in-stock plants first) and fill plant_id ONLY when you are confident, otherwise use an empty string. ' +
    'Use the price written in the note; if no price is written, fall back to the list price. ' +
    'paid_amount is the amount the customer already paid, or null if the note does not say. ' +
    'Never invent sales that are not in the image. Put any unreadable text into "note" and mark it with a "?".\n\n' +
    'STOCK LIST:\n' + (stock || '(empty)');
}

export async function parseOrderPhoto(blob, { apiKey, model, plants } = {}) {
  const key = str(apiKey);
  if (!key) throw new Error('ยังไม่ได้ใส่ Gemini API key — ไปที่ตั้งค่า');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('ต้องต่ออินเทอร์เน็ตเพื่ออ่านรูป');
  let mdl = str(model) || DEFAULT_MODEL;

  const dataUrl = await blobToDataURL(blob);
  const m = dataUrl.match(/^data:([^;,]+)[^,]*,/);
  const data = m ? dataUrl.slice(m[0].length) : dataUrl;
  let mime = (blob && blob.type) || (m && m[1]) || 'image/jpeg';
  if (!data) throw new Error('ไม่พบข้อมูลรูปภาพ');
  if (mime.indexOf('image/') !== 0) throw new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น');

  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: buildPrompt(plants) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  });
  const call = (name) => fetch(API + encodeURIComponent(name) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body
  });

  let resp;
  try {
    resp = await call(mdl);
    if (resp.status === 404 && mdl !== FALLBACK_MODEL) { mdl = FALLBACK_MODEL; resp = await call(mdl); }
  } catch (e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('ต้องต่ออินเทอร์เน็ตเพื่ออ่านรูป');
    throw new Error('เชื่อมต่อ Gemini ไม่สำเร็จ: ' + (e && e.message ? e.message : e));
  }
  const text = await resp.text();
  if (!resp.ok) {
    let msg = text;
    try { const ej = JSON.parse(text); if (ej && ej.error && ej.error.message) msg = ej.error.message; } catch (e) { /* raw text */ }
    throw new Error('Gemini ตอบกลับผิดพลาด (HTTP ' + resp.status + '): ' + String(msg).slice(0, 200));
  }
  let outText = '';
  try {
    const rj = JSON.parse(text);
    outText = rj.candidates[0].content.parts.map((p) => (p && p.text ? p.text : '')).join('');
  } catch (e) { outText = ''; }
  if (!str(outText)) throw new Error('Gemini ไม่ส่งผลลัพธ์กลับมา (รูปอาจไม่ชัดหรือถูกบล็อก) ลองถ่ายใหม่');
  const parsed = parseJsonLoose(outText);
  if (parsed === null) throw new Error('อ่านผลลัพธ์จาก Gemini ไม่สำเร็จ ลองถ่ายรูปใหม่ให้ชัดขึ้น');
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.orders) ? parsed.orders : []);

  const all = (Array.isArray(plants) ? plants : []).filter(Boolean);
  const byId = new Map(all.map((p) => [String(p.id), p]));
  const byCode = new Map(all.filter((p) => p.code).map((p) => [String(p.code).toUpperCase(), p]));
  const drafts = [];
  list.forEach((d) => {
    if (!d || typeof d !== 'object') return;
    const items = [];
    (Array.isArray(d.items) ? d.items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const ref = str(it.plant_id);
      const plant = ref ? (byId.get(ref) || byCode.get(ref.toUpperCase()) || null) : null;
      const name = str(it.name) || (plant ? str(plant.name) : '');
      if (!name) return;
      let price = num(it.unit_price, null);
      if (price === null || price < 0) price = plant ? (num(plant.price, 0)) : 0;
      let qty = num(it.qty, 1);
      if (!(qty > 0)) qty = 1;
      items.push({ plant_id: plant ? plant.id : '', name, unit_price: round2(price), qty });
    });
    let paid = num(d.paid_amount, null);
    if (paid !== null && paid < 0) paid = null;
    const draft = { customer_name: str(d.customer_name), items, paid_amount: paid === null ? null : round2(paid), note: str(d.note) };
    if (items.length || draft.note || draft.customer_name) drafts.push(draft);
  });
  return { drafts, model: mdl };
}
