// sw.js — offline shell + stale-while-revalidate
const VERSION = 'v3.1.0';
const APP_CACHE = 'plantapp-app-' + VERSION;
const LIB_CACHE = 'plantapp-lib-' + VERSION;
const PRECACHE = [
  './', 'index.html', 'styles.css', 'app.js', 'store.js', 'adapter-mock.js', 'adapter-fire.js',
  'invoice.js', 'gemini.js', 'config.js', 'manifest.webmanifest',
  'bridge.js', 'ui-crop.js', 'ui-core.js', 'ui-home.js', 'ui-orders.js', 'ui-form.js', 'ui-lists.js', 'ui-menu.js',
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
