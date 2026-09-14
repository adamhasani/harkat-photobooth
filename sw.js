// Minimal pass-through Service Worker for HARKAT Photobooth PWA
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through fetch: always go to network to avoid stale sandbox code
  e.respondWith(fetch(e.request));
});
