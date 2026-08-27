'use strict';

// Eenmalige migratie: /data/aanmeldingen.json  ->  /data/bakkumbruist.db
//
// Idempotent op twee niveaus: de migratie wordt gemarkeerd in de meta-tabel
// (dus een tweede run doet niets), en per huisnummer wordt niets overschreven
// dat al in de database staat.
//
// Het script controleert zichzelf: het telt de aanmeldingen, de huizen op
// komt=ja en het totaal aantal personen zowel uit de JSON als uit de database
// en vergelijkt die. Wijkt er iets af, dan wordt de transactie teruggedraaid
// en verandert er niets aan de live data.
//
// Draaien:  node migreer-json.js            (in de container)
//           node migreer-json.js --stil     (alleen bij fouten iets zeggen)

const fs = require('fs');
const db_ = require('./db');

const MARKER = 'json_gemigreerd_op';

// JSON-veld -> leeftijdsgroep in de database
const GROEP_VAN_VELD = {
  aantal_tm8: 'tm8',
  aantal_9_13: '9_13',
  aantal_14_18: '14_18',
  aantal_volwassenen: 'volwassen',
};

function leesJson(bestand) {
  if (!fs.existsSync(bestand)) return null;
  const ruw = fs.readFileSync(bestand, 'utf8').trim();
  if (!ruw) return [];
  const data = JSON.parse(ruw);
  if (!Array.isArray(data)) throw new Error('aanmeldingen.json bevat geen lijst');
  return data;
}

function komtUitJson(v) {
  if (v === true || v === 'ja') return 'ja';
  if (v === 'misschien') return 'misschien';
  return 'nee';
}

function aantalUit(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Telling rechtstreeks uit de JSON — de referentie waar de database naast wordt gelegd.
function tellingUitJson(records) {
  const t = { aanmeldingen: 0, komt_ja: 0, personen: 0, tm8: 0, '9_13': 0, '14_18': 0, volwassen: 0 };
  // Dubbele huisnummers: de laatste wint, net als de upsert in de server.
  const perHuis = new Map();
  for (const r of records) {
    const hn = parseInt(r.huisnummer, 10);
    if (!db_.GELDIGE_HUISNUMMERS.has(hn)) continue;
    perHuis.set(hn, r);
  }
  for (const r of perHuis.values()) {
    t.aanmeldingen++;
    if (komtUitJson(r.komt) !== 'ja') continue;
    t.komt_ja++;
    for (const [veld, groep] of Object.entries(GROEP_VAN_VELD)) {
      const n = aantalUit(r[veld]);
      t[groep] += n;
      t.personen += n;
    }
  }
  return { telling: t, perHuis: perHuis };
}

// Dezelfde telling, maar uit de database — beperkt tot de huisnummers die in
// de JSON staan, zodat later toegevoegde huizen de vergelijking niet vertroebelen.
function tellingUitDb(db, huisnummers) {
  const t = { aanmeldingen: 0, komt_ja: 0, personen: 0, tm8: 0, '9_13': 0, '14_18': 0, volwassen: 0 };
  if (!huisnummers.length) return t;
  const gaten = huisnummers.map(() => '?').join(',');
  const rijen = db.prepare(
    'SELECT id, huisnummer, komt FROM aanmelding WHERE huisnummer IN (' + gaten + ')'
  ).all(...huisnummers);
  const deelPer = db.prepare(
    "SELECT leeftijdsgroep, aantal FROM deelnemer WHERE aanmelding_id = ? AND deelname = 'dag'"
  );
  for (const rij of rijen) {
    t.aanmeldingen++;
    if (rij.komt !== 'ja') continue;
    t.komt_ja++;
    for (const d of deelPer.all(rij.id)) {
      t[d.leeftijdsgroep] += d.aantal;
      t.personen += d.aantal;
    }
  }
  return t;
}

function verschillen(a, b) {
  const uit = [];
  for (const sleutel of Object.keys(a)) {
    if (a[sleutel] !== b[sleutel]) uit.push(sleutel + ': JSON=' + a[sleutel] + ' database=' + b[sleutel]);
  }
  return uit;
}

function toonTelling(naam, t) {
  console.log('  ' + naam.padEnd(10) +
    ' aanmeldingen=' + t.aanmeldingen +
    '  komt=ja: ' + t.komt_ja +
    '  personen: ' + t.personen +
    '  (t/m 8: ' + t.tm8 + ', 9–13: ' + t['9_13'] + ', 14–18: ' + t['14_18'] + ', volwassen: ' + t.volwassen + ')');
}

// Voert de migratie uit. Geeft een verslag terug; gooit bij een controlefout.
function migreer(db, opties) {
  const stil = !!(opties && opties.stil);
  const log = stil ? function () {} : console.log.bind(console);

  const alGedaan = db_.metaGet(db, MARKER);
  const records = leesJson(db_.JSON_FILE);

  if (records === null) {
    log('Geen ' + db_.JSON_FILE + ' gevonden — niets te migreren.');
    return { status: 'geen_json' };
  }

  const { telling: json, perHuis } = tellingUitJson(records);
  const huisnummers = [...perHuis.keys()].sort((a, b) => a - b);
  const ongeldig = records.length - perHuis.size;

  if (alGedaan) {
    // Al gemigreerd. We rapporteren de vergelijking wél, maar een afwijking is
    // hier normaal: sinds de migratie kunnen mensen hun aanmelding hebben
    // aangepast. De database is vanaf dat moment de bron van waarheid.
    const nu = tellingUitDb(db, huisnummers);
    log('Al gemigreerd op ' + alGedaan + ' — er is niets veranderd.');
    toonTelling('JSON', json);
    toonTelling('database', nu);
    const diff = verschillen(json, nu);
    if (diff.length) {
      log('  (afwijking t.o.v. het archief is normaal na wijzigingen via de site: ' + diff.join('; ') + ')');
    } else {
      log('  Identiek.');
    }
    return { status: 'al_gedaan', json: json, db: nu, verschillen: diff };
  }

  log('Migreren van ' + db_.JSON_FILE + ' naar ' + db_.DB_FILE + '…');
  if (ongeldig > 0) log('  ' + ongeldig + ' record(s) overgeslagen: geen geldig Eikenhorst-huisnummer of dubbel.');

  let ingevoegd = 0, overgeslagen = 0;
  const bestaat = db.prepare('SELECT id FROM aanmelding WHERE huisnummer = ?');
  const nieuweAanmelding = db.prepare(
    'INSERT INTO aanmelding (huisnummer, komt, bron, naam, contact, opmerking, aangemaakt_op, bijgewerkt_op) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const nieuweDeelnemer = db.prepare(
    'INSERT INTO deelnemer (aanmelding_id, leeftijdsgroep, deelname, aantal) VALUES (?, ?, ?, ?)'
  );

  db_.transactie(db, function () {
    for (const hn of huisnummers) {
      const r = perHuis.get(hn);
      if (bestaat.get(hn)) { overgeslagen++; continue; }

      const ts = (r.timestamp && String(r.timestamp)) || new Date().toISOString();
      const komt = komtUitJson(r.komt);
      const bron = r.bron === 'mondeling' ? 'mondeling' : 'formulier';

      const res = nieuweAanmelding.run(
        hn, komt, bron,
        (r.naam || '').toString().slice(0, 100),
        (r.contact || '').toString().slice(0, 200),
        '',
        ts, ts
      );
      const id = Number(res.lastInsertRowid);

      // Alles wat er stond is deelname 'dag': deze mensen hebben zich voor
      // de hele dag opgegeven, het avondtarief bestond nog niet.
      if (komt === 'ja') {
        for (const [veld, groep] of Object.entries(GROEP_VAN_VELD)) {
          const n = aantalUit(r[veld]);
          if (n > 0) nieuweDeelnemer.run(id, groep, 'dag', n);
        }
      }
      ingevoegd++;
    }

    // --- Zelfcontrole binnen dezelfde transactie ---
    const na = tellingUitDb(db, huisnummers);
    const diff = verschillen(json, na);
    if (diff.length) {
      throw new Error('Migratiecontrole mislukt, niets opgeslagen:\n    ' + diff.join('\n    '));
    }
    db_.metaSet(db, MARKER, new Date().toISOString());
  });

  const na = tellingUitDb(db, huisnummers);
  log('  ' + ingevoegd + ' aanmelding(en) ingevoegd' +
    (overgeslagen ? ', ' + overgeslagen + ' overgeslagen (stond al in de database)' : '') + '.');
  log('  Controle — beide tellingen moeten gelijk zijn:');
  toonTelling('JSON', json);
  toonTelling('database', na);
  log('  ✓ Gelijk. De database is nu de bron van waarheid; de JSON blijft als archief staan.');

  return { status: 'gemigreerd', ingevoegd: ingevoegd, json: json, db: na };
}

module.exports = { migreer, MARKER };

// Standalone draaien
if (require.main === module) {
  const stil = process.argv.includes('--stil');
  const db = db_.open();
  db_.initSchema(db);
  db_.seedSnacks(db);
  try {
    migreer(db, { stil: stil });
    process.exit(0);
  } catch (e) {
    console.error('FOUT: ' + e.message);
    process.exit(1);
  }
}
