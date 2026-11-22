/* Gerichte-Roster: Service Worker (Offline-Betrieb). Bei Änderungen an dieser Datei die Version erhöhen. */
const V = 'roster-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const MAX_IMAGES = 300;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function put(key, resp){
  if (!resp || !(resp.ok || resp.type === 'opaque')) return;
  const c = await caches.open(V); await c.put(key, resp.clone());
  if (/\/bilder\//.test(String(key.url || key))){
    const ks = await c.keys(), imgs = ks.filter(k => /\/bilder\//.test(k.url));
    if (imgs.length > MAX_IMAGES) for (const k of imgs.slice(0, imgs.length - MAX_IMAGES)) await c.delete(k);
  }
}
function withTimeout(p, ms){ return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }

async function networkFirst(req, key, ms){
  try { const r = await withTimeout(fetch(req), ms); put(key, r); return r; }
  catch(e){ const m = await caches.match(key, { ignoreSearch: false }); if (m) return m; throw e; }
}
async function staleWhileRevalidate(req, key){
  const m = await caches.match(key);
  const net = fetch(req).then(r => { put(key, r); return r; }).catch(() => null);
  return m || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin){
    if (req.mode === 'navigate'){
      e.respondWith(networkFirst(req, new Request('./index.html'), 4000).catch(() => caches.match('./index.html')));
    } else if (url.pathname.endsWith('/bilder/galerie.json')){
      const key = new Request(url.origin + url.pathname);          // ohne ?t=…, sonst füllt sich der Speicher
      e.respondWith(networkFirst(req, key, 4000));
    } else if (/\/(bilder|icons)\//.test(url.pathname) || url.pathname.endsWith('.webmanifest')){
      e.respondWith(staleWhileRevalidate(req, req));
    }
  } else if (FONT_HOSTS.includes(url.hostname)){
    e.respondWith(staleWhileRevalidate(req, req));
  }
  // alles andere (Google Tabelle, GitHub, Apps Script) geht unverändert ins Netz
});
