// Goliath Strength Trainer offline support. Bump VERSION whenever index.html changes.
const VERSION = 'goliath-v27';
const SHELL = ['./', './index.html', './config.js', './auth.js', './social.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png', './notify.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Pages: network first so updates arrive, cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // App files: network first so a new version is used as soon as it is deployed; cache when offline.
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(hit => hit || caches.match(req, {ignoreSearch: true}))));
    return;
  }
  // Fonts and the pinned Supabase library never change: cache first, refresh in the background.
  if (/fonts\.(googleapis|gstatic)\.com$|^cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// ---------- push notifications ----------
self.addEventListener('push', e => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = {title: 'Goliath', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(n.title || 'Goliath', {
    body: n.body || '', tag: n.tag || undefined, renotify: !!n.tag,
    icon: './icons/icon-192.png', badge: './icons/badge-96.png',
    data: {url: n.url || './'}, vibrate: [80, 40, 80]
  }));
});
// tapping a notification opens the app (or the open copy of it) at the right screen
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open){ open.postMessage({goliath: 'go', url}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
