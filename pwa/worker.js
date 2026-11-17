const CACHE = 'show-up-' + '__BUILD_VERSION__';
const PRECACHE = __BUILD_ASSETS__;
const assets = new Set(PRECACHE);
const today = new URL('/?view=today', self.location.origin).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(PRECACHE.map(path => new Request(path, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const old = await caches.keys();
    await Promise.all(old.filter(name => name.startsWith('show-up-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status < 500) return response;
      } catch {}
      return await (await caches.open(CACHE)).match('/offline.html') || Response.error();
    })());
  } else if (assets.has(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(request) || fetch(request)));
  }
});

self.addEventListener('push', event => {
  let notification;
  try { notification = event.data?.json()?.notification; } catch {}
  event.waitUntil(self.registration.showNotification(notification?.title || 'Show Up', {
    body: notification?.body || 'Open Show Up to view today’s check-ins.',
    icon: '/icons/app-192.png',
    badge: '/icons/badge.png',
    tag: 'daily-check-in'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname === '/' && !new URL(client.url).searchParams.has('invite'));
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'show-up:today' });
    } else {
      await self.clients.openWindow(today);
    }
  })());
});
