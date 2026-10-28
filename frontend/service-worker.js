/**
 * HR Flow — Service Worker for Desktop App Caching & Offline Capabilities
 */
const CACHE_NAME = 'hrflow-app-v1';
const STATIC_ASSETS = [
  '/',
  '/login.html',
  '/dashboard.html',
  '/agent.html',
  '/casedetail.html',
  '/css/casedetail.css',
  '/img/nexus-logo-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => null);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests, bypass API routes and data fetching to keep DB live
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

