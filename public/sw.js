// Netzwerk zuerst, sonst die zuletzt gespeicherte Kopie (App startet so auch ohne Empfang).
const NAME = 'dienstplan-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => { const kopie = res.clone(); caches.open(NAME).then((c) => c.put(req, kopie)); return res; })
      .catch(() => caches.match(req).then((m) => m || caches.match('/')))
  );
});
