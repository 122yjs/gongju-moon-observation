'use strict';

// Installation is the primary goal of this service worker. We deliberately do
// not intercept fetches so a newly deployed classroom build is never hidden by
// a stale offline cache.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
