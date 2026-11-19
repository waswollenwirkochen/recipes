/**
 * Gerichte-Roster: Annahmestelle für Gästefotos (Google Apps Script)
 *
 * Gäste schicken ein Foto, es landet in einem Drive-Ordner und wartet dort auf die Freigabe.
 * Der Admin bekommt eine E-Mail, prüft das Foto auf der Website und gibt es frei oder lehnt es ab.
 *
 * Vor dem Bereitstellen die zwei Zeilen unter "EINSTELLUNGEN" anpassen.
 */

// ===== EINSTELLUNGEN =====
const REPO = 'waswollenwirkochen/recipes';
const SITE_URL = 'https://waswollenwirkochen.github.io/recipes/';
// =========================

const FOLDER_NAME = 'Gerichte-Roster Einreichungen';
const MAX_IMAGE_BYTES = 1500000;   // Obergrenze pro Foto
const MAX_PENDING = 200;           // Obergrenze offener Einsendungen

function doGet() { return json_({ ok: true, info: 'Gerichte-Roster Gästefotos' }); }

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    switch (b.action) {
      case 'submit': return json_(submit_(b));
      case 'list':   requireAdmin_(b.token); return json_(list_());
      case 'get':    requireAdmin_(b.token); return json_(get_(b.id));
      case 'done':   requireAdmin_(b.token); return json_(trash_(b.id));
      default:       return json_({ ok: false, error: 'Unbekannte Aktion' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function submit_(b) {
  if (b.hp) return { ok: true };                                   // Köderfeld gefüllt: Bot, stillschweigend verwerfen
  if (!/^[a-z0-9-]{1,80}$/.test(String(b.slug || ''))) throw new Error('Ungültiges Gericht');
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw new Error('Name fehlt');
  const dish = String(b.dish || '').trim().slice(0, 120);
  const bytes = Utilities.base64Decode(String(b.image || ''));
  if (bytes.length < 1000 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Foto zu groß oder leer');
  if (!(bytes[0] === 0xFF && bytes[1] === 0xD8)) throw new Error('Nur JPEG erlaubt');   // Bild kommt von der Website schon als JPEG

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const folder = folder_();
    let n = 0; const files = folder.getFiles(); while (files.hasNext()) { files.next(); n++; }
    if (n >= MAX_PENDING) throw new Error('Gerade zu viele offene Einsendungen');
    const t = Date.now();
    const file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', t + '_' + b.slug + '.jpg'));
    file.setDescription(JSON.stringify({ slug: b.slug, dish: dish, name: name, t: t }));
  } finally {
    lock.releaseLock();
  }
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Neues Foto zur Freigabe: ' + dish,
      name + ' hat ein Foto zu „' + dish + '“ eingesendet.\n\nFreigeben oder ablehnen:\n' + SITE_URL + '#/admin\n'
    );
  } catch (err) { /* Mail ist nur ein Hinweis, die Einsendung bleibt gespeichert */ }
  return { ok: true };
}

function requireAdmin_(token) {
  token = String(token || '');
  if (!token) throw new Error('Nicht angemeldet');
  const cache = CacheService.getScriptCache();
  const key = 'adm_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  if (cache.get(key) === '1') return;
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'gerichte-roster' },
    muteHttpExceptions: true
  });
  const ok = res.getResponseCode() === 200 && JSON.parse(res.getContentText()).permissions && JSON.parse(res.getContentText()).permissions.push === true;
  if (!ok) throw new Error('Keine Berechtigung');
  cache.put(key, '1', 300);
}

function list_() {
  const items = [];
  const files = folder_().getFiles();
  while (files.hasNext()) {
    const f = files.next();
    try { const m = JSON.parse(f.getDescription()); items.push({ id: f.getId(), slug: m.slug, dish: m.dish, name: m.name, t: m.t }); } catch (e) {}
  }
  items.sort(function (a, b) { return a.t - b.t; });
  return { ok: true, items: items };
}

function inFolder_(id) {
  const f = DriveApp.getFileById(id);
  const parents = f.getParents();
  while (parents.hasNext()) { if (parents.next().getName() === FOLDER_NAME) return f; }
  throw new Error('Datei nicht gefunden');
}

function get_(id) {
  const f = inFolder_(id);
  return { ok: true, image: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function trash_(id) {
  inFolder_(id).setTrashed(true);
  return { ok: true };
}
