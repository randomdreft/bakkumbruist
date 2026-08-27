'use strict';

// Bakkum Bruist 2026 — kleine zero-dependency Node-server.
// Serveert de statische site, verwerkt de aanmeldingen en de eetbestellingen.
//
// Opslag: SQLite op een persistent Docker-volume (/data/bakkumbruist.db) via
// de ingebouwde `node:sqlite`. Nog steeds geen npm-dependencies, geen
// framework en geen build-step — in lijn met de tobygames-server in dezelfde
// static-sites-stack. Het oude /data/aanmeldingen.json is sinds augustus 2026
// een archief: er wordt niet meer naar geschreven.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const db_ = require('./db');
const { migreer } = require('./migreer-json');

const PORT = parseInt(process.env.PORT, 10) || 80;
const STATIC_DIR = process.env.STATIC_DIR || '/static';

const {
  GELDIGE_HUISNUMMERS, TOTAAL_ADRESSEN,
  LEEFTIJDSGROEPEN, DEELNAMES, TARIEF_CENT, MAX_AANTAL, EENHEDEN,
} = db_;

const GROEP_CODES = LEEFTIJDSGROEPEN.map((g) => g.code);

// Contactadres van de organisatie, ook gebruikt in foutmeldingen.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'slems_verenigd1q@icloud.com';

// Deadline voor het bestellen. Twee losse waarden, bewust:
//  - BESTEL_DEADLINE: het moment zelf, ISO met expliciete offset, zodat er
//    geen twijfel is over zomertijd (bijv. 2026-09-08T23:59:00+02:00).
//  - BESTEL_DEADLINE_TEKST: hoe het op de site staat, in gewone taal.
const BESTEL_DEADLINE = (function () {
  const ruw = (process.env.BESTEL_DEADLINE || '2026-09-08T23:59:00+02:00').trim();
  const d = new Date(ruw);
  if (isNaN(d.getTime())) {
    console.error('BESTEL_DEADLINE onleesbaar (' + ruw + ') — bestellen blijft open.');
    return null;
  }
  return d;
})();
const BESTEL_DEADLINE_TEKST = process.env.BESTEL_DEADLINE_TEKST || 'dinsdag 8 september, 23:59';

// Wachtwoord voor /aanmeldingen komt uit de omgeving (docker-compose),
// zodat het niet in de (publieke) git-repo belandt.
const ADMIN_USER = process.env.AANMELDINGEN_USER || 'comite';
const ADMIN_PASS = process.env.AANMELDINGEN_WACHTWOORD || '';

// Optionele IP-whitelist: vanaf deze adressen/ranges is /aanmeldingen
// toegankelijk zónder wachtwoord. Komma-gescheiden in de omgeving, elk
// item een los IP of een CIDR-range, bijv.:
//   AANMELDINGEN_IP_WHITELIST=203.0.113.5,2001:db8::/48
const IP_WHITELIST = (function () {
  const lijst = new net.BlockList();
  let aantal = 0;
  for (let item of (process.env.AANMELDINGEN_IP_WHITELIST || '').split(',')) {
    item = item.trim();
    if (!item) continue;
    try {
      if (item.indexOf('/') >= 0) {
        const i = item.lastIndexOf('/');
        const addr = item.slice(0, i);
        const prefix = parseInt(item.slice(i + 1), 10);
        const fam = net.isIP(addr);
        if (fam === 4) lijst.addSubnet(addr, prefix, 'ipv4');
        else if (fam === 6) lijst.addSubnet(addr, prefix, 'ipv6');
        else throw new Error('geen geldig IP');
      } else {
        const fam = net.isIP(item);
        if (fam === 4) lijst.addAddress(item, 'ipv4');
        else if (fam === 6) lijst.addAddress(item, 'ipv6');
        else throw new Error('geen geldig IP');
      }
      aantal++;
    } catch (e) {
      console.error('IP-whitelist: item overgeslagen (' + item + '): ' + e.message);
    }
  }
  return { lijst: lijst, aantal: aantal };
})();

// --- Database openen, schema klaarzetten, JSON eenmalig migreren ---
const db = db_.open();
db_.initSchema(db);
const nieuweSnacks = db_.seedSnacks(db);
try {
  migreer(db);
} catch (e) {
  // Een mislukte controle mag de site niet platleggen: de server start wel,
  // maar de migratie is dan níét doorgevoerd (transactie teruggedraaid).
  console.error('MIGRATIE OVERGESLAGEN — ' + e.message);
}

// ---------------------------------------------------------------------------
// Voorbereide queries
// ---------------------------------------------------------------------------
const Q = {
  tellerJa: db.prepare("SELECT COUNT(*) AS n FROM aanmelding WHERE komt = 'ja'"),
  aanmeldingVanHuis: db.prepare('SELECT * FROM aanmelding WHERE huisnummer = ?'),
  alleAanmeldingen: db.prepare('SELECT * FROM aanmelding ORDER BY huisnummer'),
  deelnemersVan: db.prepare('SELECT leeftijdsgroep, deelname, aantal FROM deelnemer WHERE aanmelding_id = ?'),
  alleDeelnemers: db.prepare('SELECT aanmelding_id, leeftijdsgroep, deelname, aantal FROM deelnemer'),

  nieuweAanmelding: db.prepare(
    'INSERT INTO aanmelding (huisnummer, komt, bron, naam, contact, opmerking, aangemaakt_op, bijgewerkt_op) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateAanmelding: db.prepare(
    'UPDATE aanmelding SET komt = ?, bron = ?, naam = ?, contact = ?, opmerking = ?, bijgewerkt_op = ? WHERE id = ?'
  ),
  verwijderAanmelding: db.prepare('DELETE FROM aanmelding WHERE id = ?'),
  wisDeelnemers: db.prepare('DELETE FROM deelnemer WHERE aanmelding_id = ?'),
  nieuweDeelnemer: db.prepare(
    'INSERT INTO deelnemer (aanmelding_id, leeftijdsgroep, deelname, aantal) VALUES (?, ?, ?, ?)'
  ),

  actieveSnacks: db.prepare('SELECT * FROM snack WHERE actief = 1 ORDER BY volgorde, naam'),
  alleSnacks: db.prepare('SELECT * FROM snack ORDER BY volgorde, naam'),
  snackById: db.prepare('SELECT * FROM snack WHERE id = ? AND actief = 1'),

  bestellingVan: db.prepare('SELECT * FROM bestelling WHERE aanmelding_id = ?'),
  alleBestellingen: db.prepare('SELECT * FROM bestelling'),
  nieuweBestelling: db.prepare(
    'INSERT INTO bestelling (aanmelding_id, opmerking, aangemaakt_op, bijgewerkt_op) VALUES (?, ?, ?, ?)'
  ),
  updateBestelling: db.prepare('UPDATE bestelling SET opmerking = ?, bijgewerkt_op = ? WHERE id = ?'),
  verwijderBestelling: db.prepare('DELETE FROM bestelling WHERE id = ?'),
  wisRegels: db.prepare('DELETE FROM bestelregel WHERE bestelling_id = ?'),
  nieuweRegel: db.prepare(
    'INSERT INTO bestelregel (bestelling_id, snack_id, aantal, prijs_cent_bij_bestelling) VALUES (?, ?, ?, ?)'
  ),
  regelsVan: db.prepare(
    'SELECT r.snack_id, r.aantal, r.prijs_cent_bij_bestelling, s.slug, s.naam, s.eenheid ' +
    'FROM bestelregel r JOIN snack s ON s.id = r.snack_id WHERE r.bestelling_id = ? ORDER BY s.volgorde, s.naam'
  ),
  alleRegels: db.prepare(
    'SELECT r.bestelling_id, r.snack_id, r.aantal, r.prijs_cent_bij_bestelling, s.slug, s.naam, s.eenheid ' +
    'FROM bestelregel r JOIN snack s ON s.id = r.snack_id ORDER BY s.volgorde, s.naam'
  ),
};

// ---------------------------------------------------------------------------
// Kleine helpers
// ---------------------------------------------------------------------------
function nu() { return new Date().toISOString(); }

function leegAantallen() {
  const o = {};
  for (const c of GROEP_CODES) o[c] = 0;
  return o;
}

// Deelnemers van één aanmelding als { dag: {tm8: n, …}, avond: {…} }.
function deelnemersVan(aanmeldingId) {
  const uit = { dag: leegAantallen(), avond: leegAantallen() };
  for (const d of Q.deelnemersVan.all(aanmeldingId)) {
    if (uit[d.deelname] && Object.prototype.hasOwnProperty.call(uit[d.deelname], d.leeftijdsgroep)) {
      uit[d.deelname][d.leeftijdsgroep] = d.aantal;
    }
  }
  return uit;
}

function somVan(groep) {
  let t = 0;
  for (const c of GROEP_CODES) t += groep[c] || 0;
  return t;
}

function bijdrageCent(deel) {
  return somVan(deel.dag) * TARIEF_CENT.dag + somVan(deel.avond) * TARIEF_CENT.avond;
}

function deadlineVerstreken() {
  return !!(BESTEL_DEADLINE && Date.now() > BESTEL_DEADLINE.getTime());
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

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

// Aantal uit gebruikersinvoer: geheel getal, 0..MAX_AANTAL, alles daarbuiten
// wordt bijgeknipt in plaats van geweigerd.
function aantalUit(v, max) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, max === undefined ? MAX_AANTAL : max);
}

function huisnummerUit(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && GELDIGE_HUISNUMMERS.has(n) ? n : null;
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
  return safeEqual(decoded.slice(0, idx), ADMIN_USER) && safeEqual(decoded.slice(idx + 1), ADMIN_PASS);
}

// Echt client-IP zoals NPM het doorgeeft. X-Real-IP wordt door NPM op
// $remote_addr gezet (overschrijft de header, dus niet door de client te
// spoofen); val terug op de laatste X-Forwarded-For-waarde en de socket.
function clientIp(req) {
  let ip = (req.headers['x-real-ip'] || '').trim();
  if (!ip) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',');
    ip = (xff[xff.length - 1] || '').trim();
  }
  if (!ip && req.socket) ip = req.socket.remoteAddress || '';
  if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7); // IPv4-mapped IPv6
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct);               // zone-id eraf
  return ip;
}

function ipWhitelisted(req) {
  if (!IP_WHITELIST.aantal) return false;
  const ip = clientIp(req);
  const fam = net.isIP(ip);
  if (fam === 4) return IP_WHITELIST.lijst.check(ip, 'ipv4');
  if (fam === 6) return IP_WHITELIST.lijst.check(ip, 'ipv6');
  return false;
}

function magToegang(req) {
  return ipWhitelisted(req) || checkAuth(req);
}

function requireAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Bakkum Bruist aanmeldingen", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Wachtwoord vereist.');
}

// --- Rate-limiting ---
// Simpel telvenster per IP. Dit is een buurtsite, geen bank: het doel is
// alleen voorkomen dat iemand het formulier in een lus dichtspamt.
const VENSTER_MS = 10 * 60 * 1000;
const tellers = new Map();
function teVaak(req, sleutel, maximum) {
  const id = sleutel + '|' + clientIp(req);
  const t = Date.now();
  const rij = tellers.get(id);
  if (!rij || t > rij.tot) {
    tellers.set(id, { n: 1, tot: t + VENSTER_MS });
    return false;
  }
  rij.n++;
  return rij.n > maximum;
}
// Oude tellers opruimen zodat de map niet groeit.
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of tellers) if (t > v.tot) tellers.delete(k);
}, VENSTER_MS).unref();

// ---------------------------------------------------------------------------
// GET /api/teller — publiek, alleen een getal (ongewijzigd gedrag)
// ---------------------------------------------------------------------------
function handleTeller(res) {
  json(res, 200, { adressen: Q.tellerJa.get().n, totaal: TOTAAL_ADRESSEN });
}

// ---------------------------------------------------------------------------
// GET /api/instellingen — publiek: tarieven, deadline, contact.
// Zodat de pagina's geen bedragen of data hardcoded hoeven te hebben.
// ---------------------------------------------------------------------------
function handleInstellingen(res) {
  json(res, 200, {
    tarief_cent: TARIEF_CENT,
    leeftijdsgroepen: LEEFTIJDSGROEPEN,
    max_aantal: MAX_AANTAL,
    totaal_adressen: TOTAAL_ADRESSEN,
    bestel_deadline_tekst: BESTEL_DEADLINE_TEKST,
    bestel_deadline_verstreken: deadlineVerstreken(),
    contact_email: CONTACT_EMAIL,
  });
}

// ---------------------------------------------------------------------------
// GET /api/snacks — publiek: het actieve assortiment met prijzen
// ---------------------------------------------------------------------------
function handleSnacks(res) {
  const snacks = Q.actieveSnacks.all().map((s) => ({
    id: s.id, slug: s.slug, naam: s.naam,
    omschrijving: s.omschrijving, prijs_cent: s.prijs_cent,
    eenheid: s.eenheid, woorden: EENHEDEN[s.eenheid] || EENHEDEN.stuk,
  }));
  json(res, 200, { snacks: snacks, max_aantal: MAX_AANTAL, eenheden: EENHEDEN });
}

// ---------------------------------------------------------------------------
// POST /api/aanmelding — aanmelden of bijwerken
// ---------------------------------------------------------------------------
function handleAanmelding(req, res) {
  if (teVaak(req, 'aanmelding', 30)) return json(res, 429, { error: 'te_veel_verzoeken' });

  readBody(req).then((data) => {
    const huisnummer = huisnummerUit(data.huisnummer);
    if (huisnummer === null) return json(res, 400, { error: 'ongeldig_huisnummer' });

    const komt = (data.komt === true || data.komt === 'ja') ? 'ja' : 'nee';

    // Aantallen accepteren in twee vormen: het nieuwe {dag:{},avond:{}} en de
    // oude platte velden (aantal_tm8, …), zodat een pagina uit de cache van
    // een bezoeker blijft werken. Oude velden gelden altijd als 'dag'.
    const deel = { dag: leegAantallen(), avond: leegAantallen() };
    if (komt === 'ja') {
      const bron = data.deelnemers && typeof data.deelnemers === 'object' ? data.deelnemers : null;
      for (const soort of DEELNAMES) {
        const groepen = bron && bron[soort] && typeof bron[soort] === 'object' ? bron[soort] : {};
        for (const c of GROEP_CODES) deel[soort][c] = aantalUit(groepen[c]);
      }
      if (!bron) {
        deel.dag.tm8 = aantalUit(data.aantal_tm8);
        deel.dag['9_13'] = aantalUit(data.aantal_9_13);
        deel.dag['14_18'] = aantalUit(data.aantal_14_18);
        deel.dag.volwassen = aantalUit(data.aantal_volwassenen);
      }
      if (somVan(deel.dag) + somVan(deel.avond) < 1) {
        return json(res, 400, { error: 'geen_personen' });
      }
    }

    const naam = (data.naam || '').toString().trim().slice(0, 100);
    const contact = (data.contact || '').toString().trim().slice(0, 200);
    const opmerking = (data.opmerking || '').toString().trim().slice(0, 500);
    const tijd = nu();

    let updated = false;
    try {
      db_.transactie(db, function () {
        const bestaand = Q.aanmeldingVanHuis.get(huisnummer);
        let id;
        if (bestaand) {
          updated = true;
          id = bestaand.id;
          // Een formulier-inzending overschrijft altijd een eerdere markering
          // van de organisatie: de bewoner zelf weet het beter.
          Q.updateAanmelding.run(komt, 'formulier', naam, contact, opmerking, tijd, id);
        } else {
          id = Number(Q.nieuweAanmelding.run(
            huisnummer, komt, 'formulier', naam, contact, opmerking, tijd, tijd
          ).lastInsertRowid);
        }
        // Bij een update: álle deelnemer-rijen van dit huis vervangen, in
        // dezelfde transactie. Geen half bijgewerkte aantallen mogelijk.
        Q.wisDeelnemers.run(id);
        for (const soort of DEELNAMES) {
          for (const c of GROEP_CODES) {
            if (deel[soort][c] > 0) Q.nieuweDeelnemer.run(id, c, soort, deel[soort][c]);
          }
        }
      });
    } catch (e) {
      console.error('Opslaan aanmelding mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }

    json(res, 200, {
      status: updated ? 'updated' : 'ok',
      komt: komt === 'ja',
      dag: somVan(deel.dag),
      avond: somVan(deel.avond),
      bijdrage_cent: bijdrageCent(deel),
      mag_bestellen: komt === 'ja' && somVan(deel.dag) > 0,
      adressen: Q.tellerJa.get().n,
      totaal: TOTAAL_ADRESSEN,
    });
  }).catch(() => {
    json(res, 400, { error: 'ongeldige_data' });
  });
}

// ---------------------------------------------------------------------------
// Bestelstatus: mag dit huis bestellen, en wat staat er nu?
// Geeft bewust niets terug over naam, contact of aantallen — alleen de
// mag-wel-of-niet-status en de eigen bestelregels.
// ---------------------------------------------------------------------------
function bestelStatusVan(huisnummer) {
  const basis = {
    huisnummer: huisnummer,
    mag: false,
    readonly: false,
    reden: null,
    bericht: '',
    deadline_tekst: BESTEL_DEADLINE_TEKST,
    deadline_verstreken: deadlineVerstreken(),
    contact_email: CONTACT_EMAIL,
    bestelling: null,
  };

  const aanmelding = Q.aanmeldingVanHuis.get(huisnummer);
  if (!aanmelding) {
    return Object.assign(basis, {
      reden: 'geen_aanmelding',
      bericht: 'We hebben nog geen aanmelding van dit huis. Meld je eerst even aan, dan kun je daarna bestellen.',
    });
  }

  if (aanmelding.komt === 'misschien') {
    return Object.assign(basis, {
      reden: 'nog_niet_zeker',
      bericht: 'Volgens onze administratie weten jullie het nog niet zeker. Meld je even officieel aan, dan kun je daarna bestellen.',
    });
  }
  if (aanmelding.komt !== 'ja') {
    return Object.assign(basis, {
      reden: 'komt_niet',
      bericht: 'Volgens onze administratie komen jullie dit jaar niet. Klopt dat niet? Pas je aanmelding aan, dan kun je daarna bestellen.',
    });
  }

  const deel = deelnemersVan(aanmelding.id);
  if (somVan(deel.dag) < 1) {
    return Object.assign(basis, {
      reden: 'alleen_avond',
      bericht: 'Het eten wordt om half zes uitgedeeld en het avondprogramma begint om half acht — dan is de friet allang op. Komen jullie toch overdag? Pas dan je aanmelding aan.',
    });
  }

  // Bestaande bestelling ophalen (ook als de deadline verstreken is).
  const bestelling = Q.bestellingVan.get(aanmelding.id);
  let huidig = null;
  if (bestelling) {
    const regels = Q.regelsVan.all(bestelling.id).map((r) => ({
      snack_id: r.snack_id, slug: r.slug, naam: r.naam,
      eenheid: r.eenheid, woorden: EENHEDEN[r.eenheid] || EENHEDEN.stuk,
      aantal: r.aantal, prijs_cent: r.prijs_cent_bij_bestelling,
      regel_cent: r.aantal * r.prijs_cent_bij_bestelling,
    }));
    huidig = {
      regels: regels,
      opmerking: bestelling.opmerking,
      aantal_stuks: regels.reduce((s, r) => s + r.aantal, 0),
      totaal_cent: regels.reduce((s, r) => s + r.regel_cent, 0),
      bijgewerkt_op: bestelling.bijgewerkt_op,
    };
  }

  if (deadlineVerstreken()) {
    return Object.assign(basis, {
      mag: false,
      readonly: true,
      reden: 'deadline',
      bericht: 'De bestelling is doorgegeven aan De Toren en kan niet meer aangepast worden. Vragen? Mail ' + CONTACT_EMAIL + '.',
      bestelling: huidig,
    });
  }

  // Het eigen dagaantal meesturen: handig als hint bij "voor hoeveel personen
  // friet?". Alleen van dit huis, dus geen gegevens van iemand anders.
  return Object.assign(basis, {
    mag: true, reden: 'ok', bestelling: huidig, dag_personen: somVan(deel.dag),
  });
}

// --- GET /api/bestelstatus?huisnummer=.. ---
function handleBestelstatus(req, res, url) {
  if (teVaak(req, 'bestelstatus', 120)) return json(res, 429, { error: 'te_veel_verzoeken' });

  const huisnummer = huisnummerUit(url.searchParams.get('huisnummer'));
  if (huisnummer === null) {
    return json(res, 400, {
      error: 'ongeldig_huisnummer',
      reden: 'onbekend_huisnummer',
      bericht: 'Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?',
    });
  }
  json(res, 200, bestelStatusVan(huisnummer));
}

// ---------------------------------------------------------------------------
// POST /api/bestelling — plaatsen of bijwerken
// ---------------------------------------------------------------------------
function handleBestelling(req, res) {
  if (teVaak(req, 'bestelling', 30)) return json(res, 429, { error: 'te_veel_verzoeken' });

  readBody(req).then((data) => {
    const huisnummer = huisnummerUit(data.huisnummer);
    if (huisnummer === null) {
      return json(res, 400, {
        error: 'ongeldig_huisnummer',
        bericht: 'Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?',
      });
    }

    // Dezelfde poortwachter als de GET: nooit alleen op de client vertrouwen.
    const status = bestelStatusVan(huisnummer);
    if (!status.mag) {
      return json(res, 403, { error: status.reden, bericht: status.bericht });
    }

    // Regels valideren tegen de actieve snacks in de database.
    const binnen = Array.isArray(data.regels) ? data.regels : [];
    if (binnen.length > 50) return json(res, 400, { error: 'te_veel_regels' });

    const regels = [];
    const gezien = new Set();
    for (const r of binnen) {
      const snackId = parseInt(r && r.snack_id, 10);
      if (!Number.isInteger(snackId) || gezien.has(snackId)) continue;
      const snack = Q.snackById.get(snackId);       // alleen actieve snacks
      if (!snack) continue;
      const aantal = aantalUit(r.aantal);
      if (aantal < 1) continue;                      // 0 = gewoon niet bestellen
      gezien.add(snackId);
      regels.push({ snack: snack, aantal: aantal });
    }

    const opmerking = (data.opmerking || '').toString().trim().slice(0, 300);

    if (!regels.length) {
      return json(res, 400, {
        error: 'lege_bestelling',
        bericht: 'Er staat nog niets in de bestelling. Zet minstens één snack op 1 of hoger.',
      });
    }

    const aanmelding = Q.aanmeldingVanHuis.get(huisnummer);
    const tijd = nu();
    let updated = false;

    try {
      db_.transactie(db, function () {
        let bestelling = Q.bestellingVan.get(aanmelding.id);
        let id;
        if (bestelling) {
          updated = true;
          id = bestelling.id;
          Q.updateBestelling.run(opmerking, tijd, id);
        } else {
          id = Number(Q.nieuweBestelling.run(aanmelding.id, opmerking, tijd, tijd).lastInsertRowid);
        }
        // Regels in hun geheel vervangen — nooit optellen bij het oude.
        Q.wisRegels.run(id);
        for (const r of regels) {
          // Prijs meeschrijven zoals die nú is: een latere prijswijziging van
          // De Toren verandert de al bevestigde bestelling niet.
          Q.nieuweRegel.run(id, r.snack.id, r.aantal, r.snack.prijs_cent);
        }
      });
    } catch (e) {
      console.error('Opslaan bestelling mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }

    const na = bestelStatusVan(huisnummer);
    json(res, 200, {
      status: updated ? 'updated' : 'ok',
      bestelling: na.bestelling,
      deadline_tekst: BESTEL_DEADLINE_TEKST,
    });
  }).catch(() => {
    json(res, 400, { error: 'ongeldige_data' });
  });
}

// ---------------------------------------------------------------------------
// Organisatie-overzicht (beveiligd)
// ---------------------------------------------------------------------------
function bouwOverzicht() {
  const snacks = Q.alleSnacks.all();
  const snackById = new Map(snacks.map((s) => [s.id, s]));

  // Deelnemers in één keer ophalen en per aanmelding groeperen.
  const deelPerAanmelding = new Map();
  for (const d of Q.alleDeelnemers.all()) {
    let e = deelPerAanmelding.get(d.aanmelding_id);
    if (!e) { e = { dag: leegAantallen(), avond: leegAantallen() }; deelPerAanmelding.set(d.aanmelding_id, e); }
    if (e[d.deelname] && Object.prototype.hasOwnProperty.call(e[d.deelname], d.leeftijdsgroep)) {
      e[d.deelname][d.leeftijdsgroep] = d.aantal;
    }
  }

  // Bestellingen + regels in één keer.
  const bestellingPerAanmelding = new Map();
  const bestellingById = new Map();
  for (const b of Q.alleBestellingen.all()) {
    const rec = { id: b.id, aanmelding_id: b.aanmelding_id, opmerking: b.opmerking,
      bijgewerkt_op: b.bijgewerkt_op, regels: [], bedrag_cent: 0, aantal_stuks: 0 };
    bestellingPerAanmelding.set(b.aanmelding_id, rec);
    bestellingById.set(b.id, rec);
  }
  for (const r of Q.alleRegels.all()) {
    const b = bestellingById.get(r.bestelling_id);
    if (!b) continue;
    const regel = {
      snack_id: r.snack_id, slug: r.slug, naam: r.naam,
      eenheid: r.eenheid, woorden: EENHEDEN[r.eenheid] || EENHEDEN.stuk,
      aantal: r.aantal, prijs_cent: r.prijs_cent_bij_bestelling,
      regel_cent: r.aantal * r.prijs_cent_bij_bestelling,
    };
    b.regels.push(regel);
    b.bedrag_cent += regel.regel_cent;
    b.aantal_stuks += regel.aantal;
  }

  const totalen = {
    aangemeld: 0, afgemeld: 0, misschien: 0, gereageerd: 0, onbekend: 0,
    dag: leegAantallen(), avond: leegAantallen(),
    dag_totaal: 0, avond_totaal: 0, personen: 0,
    bijdrage_cent: 0, eten_cent: 0,
  };

  const rijen = [];
  const bestellijstTelling = new Map(); // snack_id -> {aantal, bedrag_cent}
  const zonderBestelling = [];
  const letOp = [];   // bestelling van een huis dat niet (meer) overdag komt
  let bestellijstTotaalCent = 0, bestellijstStuks = 0;

  for (const a of Q.alleAanmeldingen.all()) {
    const deel = deelPerAanmelding.get(a.id) || { dag: leegAantallen(), avond: leegAantallen() };
    const dagTotaal = somVan(deel.dag);
    const avondTotaal = somVan(deel.avond);
    const bijdrage = bijdrageCent(deel);
    const bestelling = bestellingPerAanmelding.get(a.id) || null;
    const magEten = a.komt === 'ja' && dagTotaal > 0;

    if (a.komt === 'ja') totalen.aangemeld++;
    else if (a.komt === 'misschien') totalen.misschien++;
    else totalen.afgemeld++;

    if (a.komt === 'ja') {
      for (const c of GROEP_CODES) {
        totalen.dag[c] += deel.dag[c];
        totalen.avond[c] += deel.avond[c];
      }
      totalen.dag_totaal += dagTotaal;
      totalen.avond_totaal += avondTotaal;
      totalen.bijdrage_cent += bijdrage;
    }

    if (bestelling) {
      if (magEten) {
        totalen.eten_cent += bestelling.bedrag_cent;
        bestellijstTotaalCent += bestelling.bedrag_cent;
        bestellijstStuks += bestelling.aantal_stuks;
        for (const r of bestelling.regels) {
          let t = bestellijstTelling.get(r.snack_id);
          if (!t) { t = { aantal: 0, bedrag_cent: 0 }; bestellijstTelling.set(r.snack_id, t); }
          t.aantal += r.aantal;
          t.bedrag_cent += r.regel_cent;
        }
      } else {
        // Besteld en daarna de aanmelding aangepast. Niet stilzwijgend
        // meetellen voor De Toren, wél laten zien.
        letOp.push({ huisnummer: a.huisnummer, bedrag_cent: bestelling.bedrag_cent, komt: a.komt, dag_totaal: dagTotaal });
      }
    } else if (magEten) {
      zonderBestelling.push(a.huisnummer);
    }

    rijen.push({
      huisnummer: a.huisnummer,
      komt: a.komt,
      bron: a.bron,
      naam: a.naam,
      contact: a.contact,
      opmerking: a.opmerking,
      dag: deel.dag, avond: deel.avond,
      dag_totaal: dagTotaal, avond_totaal: avondTotaal,
      bijdrage_cent: a.komt === 'ja' ? bijdrage : 0,
      eten_cent: bestelling && magEten ? bestelling.bedrag_cent : 0,
      totaal_cent: (a.komt === 'ja' ? bijdrage : 0) + (bestelling && magEten ? bestelling.bedrag_cent : 0),
      heeft_bestelling: !!bestelling,
      mag_eten: magEten,
      aangemaakt_op: a.aangemaakt_op,
      bijgewerkt_op: a.bijgewerkt_op,
    });
  }

  totalen.personen = totalen.dag_totaal + totalen.avond_totaal;
  totalen.gereageerd = totalen.aangemeld + totalen.afgemeld + totalen.misschien;
  totalen.onbekend = TOTAAL_ADRESSEN - totalen.gereageerd;

  // Bestellijst voor De Toren: in assortiment-volgorde, ook snacks die
  // inmiddels uitstaan maar wél besteld zijn.
  const bestellijst = snacks
    .filter((s) => bestellijstTelling.has(s.id))
    .map((s) => {
      const t = bestellijstTelling.get(s.id);
      return {
        slug: s.slug, naam: s.naam, aantal: t.aantal, bedrag_cent: t.bedrag_cent,
        eenheid: s.eenheid, woorden: EENHEDEN[s.eenheid] || EENHEDEN.stuk, actief: !!s.actief,
      };
    });

  const gemeld = new Set(rijen.map((r) => r.huisnummer));
  const ontbrekende = [...GELDIGE_HUISNUMMERS].filter((n) => !gemeld.has(n)).sort((x, y) => x - y);

  const bestellingen = rijen
    .filter((r) => r.heeft_bestelling)
    .map((r) => {
      const b = bestellingPerAanmelding.get(Q.aanmeldingVanHuis.get(r.huisnummer).id);
      return {
        huisnummer: r.huisnummer,
        regels: b.regels,
        aantal_stuks: b.aantal_stuks,
        bedrag_cent: b.bedrag_cent,
        opmerking: b.opmerking,
        bijgewerkt_op: b.bijgewerkt_op,
        geldig: r.mag_eten,
      };
    });

  return {
    totaal_adressen: TOTAAL_ADRESSEN,
    tarief_cent: TARIEF_CENT,
    leeftijdsgroepen: LEEFTIJDSGROEPEN,
    bestel_deadline_tekst: BESTEL_DEADLINE_TEKST,
    bestel_deadline_verstreken: deadlineVerstreken(),
    totalen: totalen,
    aanmeldingen: rijen,
    snacks: snacks.map((s) => ({
      id: s.id, slug: s.slug, naam: s.naam, prijs_cent: s.prijs_cent,
      eenheid: s.eenheid, woorden: EENHEDEN[s.eenheid] || EENHEDEN.stuk,
      actief: !!s.actief, volgorde: s.volgorde,
    })),
    eenheden: EENHEDEN,
    bestellijst: bestellijst,
    bestellijst_stuks: bestellijstStuks,
    bestellijst_totaal_cent: bestellijstTotaalCent,
    bestellingen: bestellingen,
    ontbrekende: ontbrekende,
    zonder_bestelling: zonderBestelling,
    let_op_bestellingen: letOp,
  };
}

function handleOrgOverzicht(res) {
  json(res, 200, bouwOverzicht());
}

// --- CSV-helpers ---
function csvEsc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function stuurCsv(res, bestandsnaam, tabel) {
  const csv = tabel.map((r) => r.map(csvEsc).join(';')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + bestandsnaam + '"',
    'Cache-Control': 'no-store',
  });
  res.end('﻿' + csv); // BOM zodat Excel UTF-8 herkent
}
function eur(cent) { return (cent / 100).toFixed(2).replace('.', ','); }

function handleAanmeldingenCsv(res) {
  const o = bouwOverzicht();
  const kop = ['huisnummer', 'komt', 'bron'];
  for (const g of LEEFTIJDSGROEPEN) kop.push('dag_' + g.code);
  kop.push('dag_totaal');
  for (const g of LEEFTIJDSGROEPEN) kop.push('avond_' + g.code);
  kop.push('avond_totaal', 'bijdrage_eur', 'eten_eur', 'totaal_eur', 'naam', 'contact', 'aangemaakt_op', 'bijgewerkt_op');

  const rijen = o.aanmeldingen.map((a) => {
    const r = [a.huisnummer, a.komt, a.bron];
    for (const g of LEEFTIJDSGROEPEN) r.push(a.dag[g.code]);
    r.push(a.dag_totaal);
    for (const g of LEEFTIJDSGROEPEN) r.push(a.avond[g.code]);
    r.push(a.avond_totaal, eur(a.bijdrage_cent), eur(a.eten_cent), eur(a.totaal_cent),
      a.naam, a.contact, a.aangemaakt_op, a.bijgewerkt_op);
    return r;
  });
  stuurCsv(res, 'bakkum-bruist-aanmeldingen.csv', [kop, ...rijen]);
}

function handleBestellingenCsv(res) {
  const o = bouwOverzicht();
  // Kolommen worden uit de snacktabel opgebouwd, niet hardcoded: de actieve
  // snacks plus alles wat ooit besteld is (een uitgezette snack die niemand
  // koos levert geen lege kolom op).
  const besteld = new Set();
  for (const b of o.bestellingen) for (const r of b.regels) besteld.add(r.snack_id);
  const snacks = o.snacks.filter((s) => s.actief || besteld.has(s.id));
  const kop = ['huisnummer',
    ...snacks.map((s) => s.slug + (s.eenheid === 'persoon' ? '_personen' : '_stuks')),
    'aantal_totaal', 'bedrag_eur', 'geldig', 'opmerking', 'bijgewerkt_op'];
  const rijen = o.bestellingen.map((b) => {
    const perSnack = new Map(b.regels.map((r) => [r.snack_id, r.aantal]));
    return [
      b.huisnummer,
      ...snacks.map((s) => perSnack.get(s.id) || 0),
      b.aantal_stuks, eur(b.bedrag_cent), b.geldig ? 'ja' : 'nee',
      b.opmerking, b.bijgewerkt_op,
    ];
  });
  // Slotregel met het totaal dat naar De Toren gaat.
  const totaalRij = ['TOTAAL'];
  for (const s of snacks) {
    const t = o.bestellijst.find((x) => x.slug === s.slug);
    totaalRij.push(t ? t.aantal : 0);
  }
  totaalRij.push(o.bestellijst_stuks, eur(o.bestellijst_totaal_cent), '', '', '');
  stuurCsv(res, 'bakkum-bruist-bestellingen.csv', [kop, ...rijen, totaalRij]);
}

// ---------------------------------------------------------------------------
// POST/DELETE /api/mondeling (beveiligd) — organisatie markeert een adres
// ---------------------------------------------------------------------------
function handleMondelingPost(req, res) {
  readBody(req).then((data) => {
    const huisnummer = huisnummerUit(data.huisnummer);
    if (huisnummer === null) return json(res, 400, { error: 'ongeldig_huisnummer' });
    const komt = data.komt === 'misschien' ? 'misschien' : 'nee';

    const bestaand = Q.aanmeldingVanHuis.get(huisnummer);
    // Een formulier-reactie nooit overschrijven; een eerdere markering wél.
    if (bestaand && bestaand.bron !== 'mondeling') return json(res, 409, { error: 'al_gereageerd' });

    const tijd = nu();
    try {
      db_.transactie(db, function () {
        if (bestaand) {
          Q.updateAanmelding.run(komt, 'mondeling', '', '', '', tijd, bestaand.id);
          Q.wisDeelnemers.run(bestaand.id);
        } else {
          Q.nieuweAanmelding.run(huisnummer, komt, 'mondeling', '', '', '', tijd, tijd);
        }
      });
    } catch (e) {
      console.error('Opslaan markering mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }
    json(res, 200, { status: 'ok', huisnummer: huisnummer, komt: komt });
  }).catch(() => json(res, 400, { error: 'ongeldige_data' }));
}

function handleMondelingDelete(req, res) {
  readBody(req).then((data) => {
    const huisnummer = parseInt(data.huisnummer, 10);
    if (!Number.isInteger(huisnummer)) return json(res, 400, { error: 'ongeldig_huisnummer' });
    const bestaand = Q.aanmeldingVanHuis.get(huisnummer);
    if (!bestaand || bestaand.bron !== 'mondeling') return json(res, 404, { error: 'niet_gevonden' });
    try {
      db_.transactie(db, function () { Q.verwijderAanmelding.run(bestaand.id); });
    } catch (e) {
      console.error('Verwijderen markering mislukt:', e.message);
      return json(res, 500, { error: 'opslaan_mislukt' });
    }
    json(res, 200, { status: 'ok', huisnummer: huisnummer });
  }).catch(() => json(res, 400, { error: 'ongeldige_data' }));
}

// ---------------------------------------------------------------------------
// Statische bestanden
// ---------------------------------------------------------------------------
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

// Bestandsnamen die er nooit uit mogen, ook al staan ze per ongeluk in de
// map: kopietjes zoals index.html.bak-20260818 of aanmeldingen.html.pre-eten.
// Zo'n kopie omzeilt de auth-check, die op het exacte pad matcht. Dit is
// eerder misgegaan met /proxy/config.ini op metnerdsomtafel.nl; een vangnet
// in de server is betrouwbaarder dan onthouden dat je opruimt.
const VERBODEN_BESTAND = /(^\.)|\.bak($|[.-])|\.pre-|\.orig($|[.-])|\.old($|[.-])|~$|\.sw[a-p]$/i;

function serveStatic(pathname, res) {
  let filePath = path.join(STATIC_DIR, decodeURIComponent(pathname));
  if (filePath.endsWith('/')) filePath += 'index.html';
  if (!path.resolve(filePath).startsWith(STATIC_DIR)) {
    res.writeHead(403); return res.end('Verboden');
  }
  if (VERBODEN_BESTAND.test(path.basename(filePath))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Niet gevonden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Niet gevonden');
    }
    serveFile(filePath, res);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
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

  // --- Publieke API ---
  if (p === '/api/teller') {
    if (req.method === 'GET') return handleTeller(res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/instellingen') {
    if (req.method === 'GET') return handleInstellingen(res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/snacks') {
    if (req.method === 'GET') return handleSnacks(res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/aanmelding') {
    if (req.method === 'POST') return handleAanmelding(req, res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/bestelstatus') {
    if (req.method === 'GET') return handleBestelstatus(req, res, url);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }
  if (p === '/api/bestelling') {
    if (req.method === 'POST') return handleBestelling(req, res);
    return json(res, 405, { error: 'methode_niet_toegestaan' });
  }

  // --- Bestelpagina ---
  if (p === '/eten' || p === '/eten/') {
    return serveFile(path.join(STATIC_DIR, 'eten.html'), res);
  }

  // --- Beveiligd: organisatie-pagina én alle data-endpoints eronder ---
  const beveiligd = p === '/aanmeldingen' || p === '/aanmeldingen/' ||
    p === '/aanmeldingen.html' ||
    p === '/api/mondeling' ||
    p.startsWith('/api/organisatie/') ||
    p === '/api/aanmeldingen' || p === '/api/aanmeldingen.csv';

  if (beveiligd) {
    if (!magToegang(req)) return requireAuth(res);

    if (req.method === 'GET') {
      if (p === '/api/organisatie/overzicht') return handleOrgOverzicht(res);
      if (p === '/api/organisatie/aanmeldingen.csv') return handleAanmeldingenCsv(res);
      if (p === '/api/organisatie/bestellingen.csv') return handleBestellingenCsv(res);
      // Oude paden blijven werken, zodat een opgeslagen bladwijzer of een
      // pagina uit de cache niet stukgaat.
      if (p === '/api/aanmeldingen') return handleOrgOverzicht(res);
      if (p === '/api/aanmeldingen.csv') return handleAanmeldingenCsv(res);
    }
    if (p === '/api/mondeling') {
      if (req.method === 'POST') return handleMondelingPost(req, res);
      if (req.method === 'DELETE') return handleMondelingDelete(req, res);
      return json(res, 405, { error: 'methode_niet_toegestaan' });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'niet_gevonden' });

    // de pagina zelf
    return serveFile(path.join(STATIC_DIR, 'aanmeldingen.html'), res,
      { 'X-Robots-Tag': 'noindex, nofollow' });
  }

  return serveStatic(p, res);
}

server.listen(PORT, '0.0.0.0', () => {
  const n = Q.tellerJa.get().n;
  const totaalAanm = db.prepare('SELECT COUNT(*) AS n FROM aanmelding').get().n;
  const totaalBest = db.prepare('SELECT COUNT(*) AS n FROM bestelling').get().n;
  console.log('Bakkum Bruist server op poort ' + PORT +
    ' — database ' + db_.DB_FILE +
    ', ' + totaalAanm + ' aanmelding(en) (' + n + ' komen), ' +
    totaalBest + ' bestelling(en), ' +
    Q.actieveSnacks.all().length + ' actieve snack(s)' +
    (nieuweSnacks ? ' (' + nieuweSnacks + ' nieuw geseed)' : '') +
    ', ' + TOTAAL_ADRESSEN + ' geldige adressen' +
    (IP_WHITELIST.aantal ? ', ' + IP_WHITELIST.aantal + ' IP-whitelist-regel(s)' : '') +
    (BESTEL_DEADLINE ? ', besteldeadline ' + BESTEL_DEADLINE.toISOString() + (deadlineVerstreken() ? ' (VERSTREKEN)' : '') : ', GEEN besteldeadline') +
    (ADMIN_PASS ? '' : ' — LET OP: geen AANMELDINGEN_WACHTWOORD ingesteld'));
});
