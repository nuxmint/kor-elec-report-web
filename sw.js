// Built by src/publish_phone.py. VERSION is a hash of the site files, so each release replaces the cached shell.
// Several sites share this address and its caches, so every name here carries this site's prefix.
// Reports and the library are not cached here: phone.js keeps the encrypted files in IndexedDB.
const PREFIX = 'kor-elec-';
const VERSION = `${PREFIX}d104f33af0b2`;
const SHELL = ["./", "index.html", "phone.js", "style.css", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // GitHub Pages lets browsers keep files for 10 minutes, so ask the server or a new version could store old files.
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/') || url.pathname.includes('/reports/')) return;
  // Shell: network first so a new release shows at once; the cached copy is the offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then((cached) => cached || caches.match('./'))),
  );
});
