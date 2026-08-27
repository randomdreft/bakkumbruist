'use strict';

// Bakkum Bruist 2026 — databaselaag.
// SQLite via de ingebouwde `node:sqlite` van Node 22, dus nog steeds
// zero-dependency: geen npm-install, geen native build in de daily pipeline.
// De database is sinds augustus 2026 de enige bron van waarheid; het oude
// /data/aanmeldingen.json blijft als archief staan en wordt niet meer
// beschreven (zie migreer-json.js).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'bakkumbruist.db');
const JSON_FILE = path.join(DATA_DIR, 'aanmeldingen.json');

// --- Geldige huisnummers Eikenhorst (één definitie, hier) ---
// Oneven 1 t/m 77 (39 stuks) + even 2 t/m 28 (14 stuks) = 53 adressen.
const GELDIGE_HUISNUMMERS = (function () {
  const set = new Set();
  for (let n = 1; n <= 77; n += 2) set.add(n);
  for (let n = 2; n <= 28; n += 2) set.add(n);
  return set;
})();
const TOTAAL_ADRESSEN = GELDIGE_HUISNUMMERS.size; // 53

// --- Vaste waardenlijsten ---
// Volgorde = weergavevolgorde in formulier, tabellen en CSV.
const LEEFTIJDSGROEPEN = [
  { code: 'tm8', label: 'Kinderen t/m 8 jaar', kort: 't/m 8' },
  { code: '9_13', label: 'Kinderen 9 t/m 13 jaar', kort: '9–13' },
  { code: '14_18', label: 'Jongeren 14 t/m 18 jaar', kort: '14–18' },
  { code: 'volwassen', label: 'Volwassenen (vanaf 19)', kort: 'volw.' },
];
const DEELNAMES = ['dag', 'avond'];

// Tarief per persoon, in centen. Overschrijfbaar via de omgeving zodat een
// prijswijziging geen code-wijziging is.
const TARIEF_CENT = {
  dag: parseInt(process.env.TARIEF_DAG_CENT, 10) || 1750,   // € 17,50 — hele dag
  avond: parseInt(process.env.TARIEF_AVOND_CENT, 10) || 750, // € 7,50 — alleen avond
};

// Maximum per teller (aanmelding én bestelling).
const MAX_AANTAL = 20;

// --- Snack-assortiment: de startwaarden ---
// Alleen gebruikt om een lege tabel te vullen; bestaande rijen worden nooit
// overschreven, zodat prijswijzigingen van De Toren blijven staan.
const SNACK_SEED = [
  { slug: 'frikandel', naam: 'Frikandel', omschrijving: '', prijs_cent: 290, volgorde: 10 },
  { slug: 'kroket', naam: 'Kroket', omschrijving: '', prijs_cent: 300, volgorde: 20 },
  { slug: 'kaassouffle', naam: 'Kaassoufflé', omschrijving: '', prijs_cent: 300, volgorde: 30 },
];

// --- Schema ---
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  sleutel TEXT PRIMARY KEY,
  waarde  TEXT NOT NULL
);

-- Eén rij per huisnummer. De kolom komt is drie-standig: de organisatie kan een
-- adres ook als 'misschien' markeren (bron 'mondeling'), dus geen 0/1.
CREATE TABLE IF NOT EXISTS aanmelding (
  id            INTEGER PRIMARY KEY,
  huisnummer    INTEGER NOT NULL UNIQUE,
  komt          TEXT    NOT NULL CHECK (komt IN ('ja','nee','misschien')),
  bron          TEXT    NOT NULL DEFAULT 'formulier' CHECK (bron IN ('formulier','mondeling')),
  naam          TEXT    NOT NULL DEFAULT '',
  contact       TEXT    NOT NULL DEFAULT '',
  opmerking     TEXT    NOT NULL DEFAULT '',
  aangemaakt_op TEXT    NOT NULL,
  bijgewerkt_op TEXT    NOT NULL
);

-- De aantallen, uitgesplitst naar leeftijdsgroep én soort deelname.
-- Bewust een aparte tabel: een extra leeftijdsgroep of tariefsoort is dan
-- een rij, geen schemawijziging.
CREATE TABLE IF NOT EXISTS deelnemer (
  id             INTEGER PRIMARY KEY,
  aanmelding_id  INTEGER NOT NULL REFERENCES aanmelding(id) ON DELETE CASCADE,
  leeftijdsgroep TEXT    NOT NULL CHECK (leeftijdsgroep IN ('tm8','9_13','14_18','volwassen')),
  deelname       TEXT    NOT NULL CHECK (deelname IN ('dag','avond')),
  aantal         INTEGER NOT NULL CHECK (aantal >= 0),
  UNIQUE (aanmelding_id, leeftijdsgroep, deelname)
);
CREATE INDEX IF NOT EXISTS idx_deelnemer_aanmelding ON deelnemer(aanmelding_id);

-- Het assortiment van De Toren. Formulier en overzichten worden hier
-- volledig uit opgebouwd; nergens een hardcoded lijstje.
CREATE TABLE IF NOT EXISTS snack (
  id           INTEGER PRIMARY KEY,
  slug         TEXT    NOT NULL UNIQUE,
  naam         TEXT    NOT NULL,
  omschrijving TEXT    NOT NULL DEFAULT '',
  prijs_cent   INTEGER NOT NULL CHECK (prijs_cent >= 0),
  actief       INTEGER NOT NULL DEFAULT 1 CHECK (actief IN (0,1)),
  volgorde     INTEGER NOT NULL DEFAULT 0
);

-- Eén bestelling per huis.
CREATE TABLE IF NOT EXISTS bestelling (
  id            INTEGER PRIMARY KEY,
  aanmelding_id INTEGER NOT NULL UNIQUE REFERENCES aanmelding(id) ON DELETE CASCADE,
  opmerking     TEXT    NOT NULL DEFAULT '',
  aangemaakt_op TEXT    NOT NULL,
  bijgewerkt_op TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS bestelregel (
  id                        INTEGER PRIMARY KEY,
  bestelling_id             INTEGER NOT NULL REFERENCES bestelling(id) ON DELETE CASCADE,
  snack_id                  INTEGER NOT NULL REFERENCES snack(id),
  aantal                    INTEGER NOT NULL CHECK (aantal >= 1),
  -- Opzettelijk gedenormaliseerd: wijzigt De Toren de prijs ná een
  -- bestelling, dan blijft de al verstuurde bevestiging kloppen.
  prijs_cent_bij_bestelling INTEGER NOT NULL CHECK (prijs_cent_bij_bestelling >= 0),
  UNIQUE (bestelling_id, snack_id)
);
CREATE INDEX IF NOT EXISTS idx_bestelregel_bestelling ON bestelregel(bestelling_id);
`;

function open(bestand) {
  const file = bestand || DB_FILE;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function initSchema(db) {
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta (sleutel, waarde) VALUES ('schema_versie','1') " +
    'ON CONFLICT(sleutel) DO NOTHING').run();
}

// Vult ontbrekende snacks aan. Nog eens draaien verandert niets aan wat er
// al staat — prijs en actief-vlag blijven van de beheerder.
function seedSnacks(db) {
  const bestaat = db.prepare('SELECT 1 FROM snack WHERE slug = ?');
  const invoegen = db.prepare(
    'INSERT INTO snack (slug, naam, omschrijving, prijs_cent, actief, volgorde) VALUES (?, ?, ?, ?, 1, ?)'
  );
  let toegevoegd = 0;
  for (const s of SNACK_SEED) {
    if (bestaat.get(s.slug)) continue;
    invoegen.run(s.slug, s.naam, s.omschrijving, s.prijs_cent, s.volgorde);
    toegevoegd++;
  }
  return toegevoegd;
}

function metaGet(db, sleutel) {
  const rij = db.prepare('SELECT waarde FROM meta WHERE sleutel = ?').get(sleutel);
  return rij ? rij.waarde : null;
}
function metaSet(db, sleutel, waarde) {
  db.prepare('INSERT INTO meta (sleutel, waarde) VALUES (?, ?) ' +
    'ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde').run(sleutel, String(waarde));
}

// Kleine helper: draai fn() in één transactie, rol terug bij een fout.
function transactie(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* al teruggerold */ }
    throw e;
  }
}

module.exports = {
  DATA_DIR, DB_FILE, JSON_FILE,
  GELDIGE_HUISNUMMERS, TOTAAL_ADRESSEN,
  LEEFTIJDSGROEPEN, DEELNAMES, TARIEF_CENT, MAX_AANTAL, SNACK_SEED,
  open, initSchema, seedSnacks, metaGet, metaSet, transactie,
};
