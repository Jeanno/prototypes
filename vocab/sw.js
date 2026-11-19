// Stale-while-revalidate: instant and offline from cache, refreshed in the background.
const CACHE = 'wordhoard-v2';
const CORE = ['./', 'index.html', 'words.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CACHEABLE = url => url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !CACHEABLE(url)) return;
  // Pages go network-first so updates show on the next launch; cache after 3s or offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(cache => {
      const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
      const fallback = new Promise(r => setTimeout(r, 3000)).then(() => cache.match(e.request, { ignoreSearch: true }));
      return Promise.race([net.catch(() => cache.match(e.request, { ignoreSearch: true })), fallback.then(hit => hit || net)]);
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: url.origin === location.origin });
    const fresh = fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    if (hit) { e.waitUntil(fresh); return hit; }
    return fresh;
  }));
});
