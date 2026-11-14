// sw.js — offline shell + stale-while-revalidate
const VERSION = 'v3.3.0';
const APP_CACHE = 'plantapp-app-' + VERSION;
const LIB_CACHE = 'plantapp-lib-' + VERSION;
const PRECACHE = [
  './', 'index.html', 'styles.css', 'app.js', 'store.js', 'adapter-mock.js', 'adapter-fire.js',
  'invoice.js', 'label.js', 'gemini.js', 'config.js', 'manifest.webmanifest',
  'bridge.js', 'push.js', 'ui-crop.js', 'ui-core.js', 'ui-home.js', 'ui-orders.js', 'ui-form.js', 'ui-lists.js', 'ui-menu.js',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // แคชทีละไฟล์ — ไฟล์ไหนหาไม่เจอก็ข้าม ไม่ให้การติดตั้งล้มทั้งชุด
    await Promise.all(PRECACHE.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { cache: 'reload' }));
        if (res && res.ok) await cache.put(new Request(u), res);
      } catch (e) { /* ignore */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== APP_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function notifyUpdated(url) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage({ type: 'updated', url }));
}

async function sameOrigin(request) {
  const cache = await caches.open(APP_CACHE);
  const isNav = request.mode === 'navigate';
  const key = isNav ? new Request('index.html') : request;
  const cached = await cache.match(key, { ignoreSearch: true });
  const refresh = (async () => {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') {
      if (cached) {
        // บอก UI เมื่อไฟล์แอปเปลี่ยนจริงๆ
        try {
          const [a, b] = await Promise.all([cached.clone().text(), res.clone().text()]);
          if (a !== b) { await cache.put(key, res.clone()); notifyUpdated(request.url); }
        } catch (e) { await cache.put(key, res.clone()); }
      } else {
        await cache.put(key, res.clone());
      }
    }
    return res;
  })();
  if (cached) { refresh.catch(() => {}); return cached; }
  try { return await refresh; } catch (e) {
    if (isNav) { const fb = await cache.match('index.html', { ignoreSearch: true }); if (fb) return fb; }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(sameOrigin(req));
  } else if (url.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

// ---------------------------------------------------------------- web push (data-only FCM messages, no Firebase code here)
function parsePush(event) {
  let d = null;
  try { d = event.data ? event.data.json() : null; } catch (e) {
    try { d = { body: event.data.text() }; } catch (x) { d = null; }
  }
  if (!d || typeof d !== 'object') d = {};
  const data = d.data && typeof d.data === 'object' ? d.data : {};
  const n = d.notification && typeof d.notification === 'object' ? d.notification : {};
  const pick = (k) => String(data[k] || n[k] || d[k] || '');
  return { title: pick('title') || 'Plant Orders', body: pick('body'), tag: pick('tag'), url: pick('url') || './?tab=orders&filter=ship' };
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let p;
    try { p = parsePush(event); } catch (e) { p = { title: 'Plant Orders', body: '', tag: '', url: './' }; }
    const opts = { body: p.body, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: p.url } };
    if (p.tag) opts.tag = p.tag;
    await self.registration.showNotification(p.title, opts);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || './';
  let url;
  try { url = new URL(raw, self.registration.scope).href; } catch (e) { url = self.registration.scope; }
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = list.filter((c) => c.url && c.url.indexOf(self.registration.scope) === 0);
    const c = mine[0];
    if (c) {
      try { await c.focus(); } catch (e) { /* ignore */ }
      try { c.postMessage({ type: 'navigate', url }); } catch (e) { /* ignore */ }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
