// Agenda Pontivi: guscio dell'app in cache, dati sempre dalla rete se disponibile (altrimenti ultimi scaricati)
const CACHE = 'agenda-pontivi-v1';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // rete prima, cache come riserva: così dati e codice sono sempre gli ultimi pubblicati
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); const key = u.pathname.endsWith('data.json') ? new Request(u.origin + u.pathname) : e.request; caches.open(CACHE).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(u.pathname.endsWith('data.json') ? new Request(u.origin + u.pathname) : e.request, { ignoreSearch: true })));
});
