'use strict';

// Bakkum Bruist 2026 — kleine zero-dependency Node-server.
// Serveert de statische site én verwerkt de aanmeldingen.
// Opslag: één JSON-bestand op een persistent Docker-volume (/data).
// Geen frameworks, geen npm-dependencies — bewust simpel gehouden,
// in lijn met de tobygames-server in dezelfde static-sites-stack.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 80;
const STATIC_DIR = process.env.STATIC_DIR || '/static';
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'aanmeldingen.json');
// Adressen die zich mondeling hebben afgemeld bij de organisatie
// (dus niet via het webformulier). Apart bestand zodat de
// formulier-data zuiver blijft.
const MONDELING_FILE = path.join(DATA_DIR, 'mondeling.json');

// Wachtwoord voor /aanmeldingen komt uit de omgeving (docker-compose),
// zodat het niet in de (publieke) git-repo belandt.
const ADMIN_USER = process.env.AANMELDINGEN_USER || 'comite';
const ADMIN_PASS = process.env.AANMELDINGEN_WACHTWOORD || '';

// --- Geldige huisnummers Eikenhorst (hardcoded, exact 53 adressen) ---
// Oneven 1 t/m 77 (39 stuks) + even 2 t/m 28 (14 stuks).
const GELDIGE_HUISNUMMERS = (function () {
  const set = new Set();
  for (let n = 1; n <= 77; n += 2) set.add(n);   // oneven 1–77
  for (let n = 2; n <= 28; n += 2) set.add(n);    // even 2–28
  return set;
})();
const TOTAAL_ADRESSEN = GELDIGE_HUISNUMMERS.size; // 53

// --- Opslag ---
let aanmeldingen = []; // [{ timestamp, huisnummer, komt, aantal_tm8, aantal_9_13, aantal_14_18, aantal_volwassenen, naam, contact }]
let mondeling = [];    // [{ huisnummer, timestamp, opmerking }] — door de organisatie mondeling afgemeld

function loadJsonArray(file) {
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('Kon ' + file + ' niet laden:', e.message);
  }
  return [];
}

function loadData() {
  aanmeldingen = loadJsonArray(DATA_FILE);
  mondeling = loadJsonArray(MONDELING_FILE);
}

function saveJsonArray(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Atomair schrijven: eerst naar tmp, dan hernoemen. Voorkomt corruptie.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function saveData() { saveJsonArray(DATA_FILE, aanmeldingen); }
function saveMondeling() { saveJsonArray(MONDELING_FILE, mondeling); }

// --- Helpers ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e5) { reject(new Error('te groot')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function toTeller(n) {
  // Aantal unieke adressen dat "komt = ja" heeft opgegeven.
  return aanmeldingen.filter((a) => a.komt === true).length;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Veilige, constante-tijd wachtwoordvergelijking voor basic auth.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req) {
  if (!ADMIN_PASS) return false; // geen wachtwoord ingesteld → geen toegang
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch (e) { return false; }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASS);
}

function requireAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Bakkum Bruist aanmeldingen", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Wachtwoord vereist.');
}

// --- POST /api/aanmelding ---
function handleAanmelding(req, res) {
  readBody(req).then((data) => {
    const huisnummer = parseInt(data.huisnummer, 10);
    if (!Number.isInteger(huisnummer) || !GELDIGE_HUISNUMMERS.has(huisnummer)) {
      return json(res, 400, { error: 'ongeldig_huisnummer' });
    }

    const komt = data.komt === true || data.komt === 'ja';

    function aantal(v) {
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) return 0;
      return Math.min(n, 20);
    }

    let tm8 = 0, n9_13 = 0, n14_18 = 0, volw = 0;
    if (komt) {
      tm8 = aantal(data.aantal_tm8);
      n9_13 = aantal(data.aantal_9_13);
      n14_18 = aantal(data.aantal_14_18);
      volw = aantal(data.aantal_volwassenen);
      if (tm8 + n9_13 + n14_18 + volw < 1) {
        return json(res, 400, { error: 'geen_personen' });
      }
    }

    const naam = (data.naam || '').toString().trim().slice(0, 100);
    const contact = (data.contact || '').toString().trim().slice(0, 200);

    const record = {
      timestamp: new Date().toISOString(),
      huisnummer: huisnummer,
      komt: komt,
      aantal_tm8: tm8,
      aantal_9_13: n9_13,
      aantal_14_18: n14_18,
      aantal_volwassenen: volw,
      naam: naam,
      contact: contact,
    };

    // Eén aanmelding per huisnummer → upsert (nieuwste is geldend).
    const idx = aanmeldingen.findIndex((a) => a.huisnummer === huisnummer);
    const updated = idx >= 0;
    if (updated) aanmeldingen[idx] = record;
    else aanmeldingen.push(record);

    try { saveData(); }
    catch (e) {
      console.error('Opslaan mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }

    json(res, 200, {
      status: updated ? 'updated' : 'ok',
      komt: komt,
      adressen: toTeller(),
      totaal: TOTAAL_ADRESSEN,
    });
  }).catch(() => {
    json(res, 400, { error: 'ongeldige_data' });
  });
}

// --- GET /api/teller (publiek, geen persoonsgegevens) ---
function handleTeller(res) {
  json(res, 200, { adressen: toTeller(), totaal: TOTAAL_ADRESSEN });
}

// --- GET /api/aanmeldingen (beveiligd) ---
function handleAdminData(res) {
  const aangemeld = aanmeldingen.filter((a) => a.komt === true).length;
  const afgemeld_digitaal = aanmeldingen.filter((a) => a.komt === false).length;
  const afgemeld_mondeling = mondeling.length;

  const totalen = {
    // 3-staten-telling — telt altijd op tot totaal_adressen
    aangemeld: aangemeld,
    afgemeld: afgemeld_digitaal + afgemeld_mondeling,
    afgemeld_digitaal: afgemeld_digitaal,
    afgemeld_mondeling: afgemeld_mondeling,
    gereageerd: aangemeld + afgemeld_digitaal + afgemeld_mondeling,
    onbekend: TOTAAL_ADRESSEN - aangemeld - afgemeld_digitaal - afgemeld_mondeling,
    // personen-statistiek (alleen van wie komt)
    tm8: 0, n9_13: 0, n14_18: 0, volwassenen: 0, personen: 0,
  };
  for (const a of aanmeldingen) {
    if (!a.komt) continue;
    totalen.tm8 += a.aantal_tm8 || 0;
    totalen.n9_13 += a.aantal_9_13 || 0;
    totalen.n14_18 += a.aantal_14_18 || 0;
    totalen.volwassenen += a.aantal_volwassenen || 0;
  }
  totalen.personen = totalen.tm8 + totalen.n9_13 + totalen.n14_18 + totalen.volwassenen;

  // Huisnummers die echt nog niets hebben laten horen
  // (niet via formulier én niet mondeling afgemeld).
  const gemeld = new Set(aanmeldingen.map((a) => a.huisnummer));
  const mondelingSet = new Set(mondeling.map((m) => m.huisnummer));
  const ontbrekende = [...GELDIGE_HUISNUMMERS]
    .filter((n) => !gemeld.has(n) && !mondelingSet.has(n))
    .sort((x, y) => x - y);

  const lijst = aanmeldingen.slice().sort((x, y) => x.huisnummer - y.huisnummer);
  const mondelingLijst = mondeling.slice().sort((x, y) => x.huisnummer - y.huisnummer);

  json(res, 200, {
    aanmeldingen: lijst,
    mondeling: mondelingLijst,
    totalen: totalen,
    ontbrekende: ontbrekende,
    totaal_adressen: TOTAAL_ADRESSEN,
  });
}

// --- POST /api/mondeling (beveiligd) — markeer adres als mondeling afgemeld ---
function handleMondelingPost(req, res) {
  readBody(req).then((data) => {
    const huisnummer = parseInt(data.huisnummer, 10);
    if (!Number.isInteger(huisnummer) || !GELDIGE_HUISNUMMERS.has(huisnummer)) {
      return json(res, 400, { error: 'ongeldig_huisnummer' });
    }
    // Een adres dat al via het formulier reageerde, niet overschrijven.
    if (aanmeldingen.some((a) => a.huisnummer === huisnummer)) {
      return json(res, 409, { error: 'al_gereageerd' });
    }

    const opmerking = (data.opmerking || '').toString().trim().slice(0, 200);
    const record = { huisnummer: huisnummer, timestamp: new Date().toISOString(), opmerking: opmerking };

    const idx = mondeling.findIndex((m) => m.huisnummer === huisnummer);
    if (idx >= 0) mondeling[idx] = record;
    else mondeling.push(record);

    try { saveMondeling(); }
    catch (e) {
      console.error('Opslaan mondeling mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }
    json(res, 200, { status: 'ok', huisnummer: huisnummer });
  }).catch(() => {
    json(res, 400, { error: 'ongeldige_data' });
  });
}

// --- DELETE /api/mondeling (beveiligd) — maak mondeling-afmelding ongedaan ---
function handleMondelingDelete(req, res) {
  readBody(req).then((data) => {
    const huisnummer = parseInt(data.huisnummer, 10);
    if (!Number.isInteger(huisnummer)) {
      return json(res, 400, { error: 'ongeldig_huisnummer' });
    }
    const idx = mondeling.findIndex((m) => m.huisnummer === huisnummer);
    if (idx < 0) return json(res, 404, { error: 'niet_gevonden' });
    mondeling.splice(idx, 1);

    try { saveMondeling(); }
    catch (e) {
      console.error('Opslaan mondeling mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }
    json(res, 200, { status: 'ok', huisnummer: huisnummer });
  }).catch(() => {
    json(res, 400, { error: 'ongeldige_data' });
  });
}

// --- GET /api/aanmeldingen.csv (beveiligd) ---
function handleAdminCsv(res) {
  const head = ['huisnummer', 'komt', 'kinderen_tm8', 'kinderen_9_13', 'jongeren_14_18', 'volwassenen', 'naam', 'contact', 'tijdstip'];
  const rows = aanmeldingen.slice().sort((x, y) => x.huisnummer - y.huisnummer).map((a) => [
    a.huisnummer,
    a.komt ? 'ja' : 'nee',
    a.komt ? a.aantal_tm8 : '',
    a.komt ? a.aantal_9_13 : '',
    a.komt ? a.aantal_14_18 : '',
    a.komt ? a.aantal_volwassenen : '',
    a.naam || '',
    a.contact || '',
    a.timestamp,
  ]);
  function esc(v) {
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csv = [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="bakkum-bruist-aanmeldingen.csv"',
  });
  res.end('﻿' + csv); // BOM zodat Excel UTF-8 herkent
}

// --- Statische bestanden ---
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8',
};

function serveFile(filePath, res, extraHeaders) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, Object.assign({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  }, extraHeaders || {}));
  stream.pipe(res);
  stream.on('error', () => { res.writeHead(500); res.end('Fout'); });
}

function serveStatic(pathname, res) {
  let filePath = path.join(STATIC_DIR, decodeURIComponent(pathname));
  if (filePath.endsWith('/')) filePath += 'index.html';
  if (!path.resolve(filePath).startsWith(STATIC_DIR)) {
    res.writeHead(403); return res.end('Verboden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Niet gevonden');
    }
    serveFile(filePath, res);
  });
}

// --- Router ---
const server = http.createServer((req, res) => {
  try {
    route(req, res);
  } catch (e) {
    // Geen enkele request mag de server platleggen.
    console.error('Onverwachte fout:', e && e.stack ? e.stack : e);
    try { json(res, 500, { error: 'serverfout' }); } catch (_) { /* response al begonnen */ }
  }
});

function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // API
  if (p === '/api/aanmelding') {
    if (req.method === 'POST') return handleAanmelding(req, res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/teller' && req.method === 'GET') {
    return handleTeller(res);
  }

  // Beveiligde organisatie-pagina + data-endpoints
  if (p === '/aanmeldingen' || p === '/aanmeldingen/' ||
      p === '/api/aanmeldingen' || p === '/api/aanmeldingen.csv' ||
      p === '/api/mondeling') {
    if (!checkAuth(req)) return requireAuth(res);

    if (p === '/api/aanmeldingen' && req.method === 'GET') return handleAdminData(res);
    if (p === '/api/aanmeldingen.csv' && req.method === 'GET') return handleAdminCsv(res);
    if (p === '/api/mondeling') {
      if (req.method === 'POST') return handleMondelingPost(req, res);
      if (req.method === 'DELETE') return handleMondelingDelete(req, res);
      return json(res, 405, { error: 'methode_niet_toegestaan' });
    }

    // de pagina zelf
    const adminFile = path.join(STATIC_DIR, 'aanmeldingen.html');
    return serveFile(adminFile, res, { 'X-Robots-Tag': 'noindex, nofollow' });
  }

  // Statische bestanden (verberg de admin-pagina voor direct ophalen zonder auth)
  if (p === '/aanmeldingen.html') return requireAuth(res);

  return serveStatic(p, res);
}

loadData();
server.listen(PORT, '0.0.0.0', () => {
  console.log('Bakkum Bruist server op poort ' + PORT +
    ' — ' + aanmeldingen.length + ' aanmelding(en) geladen, ' +
    TOTAAL_ADRESSEN + ' geldige adressen' +
    (ADMIN_PASS ? '' : ' — LET OP: geen AANMELDINGEN_WACHTWOORD ingesteld'));
});
