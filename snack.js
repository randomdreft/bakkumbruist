'use strict';

// Beheer van het snack-assortiment. Het bestelformulier en alle overzichten
// worden volledig uit deze tabel opgebouwd, dus een snack toevoegen of
// uitzetten is één commando — nergens anders iets aanpassen.
//
//   sudo docker exec bakkumbruist node snack.js lijst
//   sudo docker exec bakkumbruist node snack.js toevoegen kipcorn "Kipcorn" 250
//   sudo docker exec bakkumbruist node snack.js toevoegen soep "Soep" 200 --per persoon
//   sudo docker exec bakkumbruist node snack.js prijs frikandel 310
//   sudo docker exec bakkumbruist node snack.js uit kaassouffle
//   sudo docker exec bakkumbruist node snack.js aan kaassouffle
//   sudo docker exec bakkumbruist node snack.js naam friet "Patat"
//   sudo docker exec bakkumbruist node snack.js eenheid friet persoon
//   sudo docker exec bakkumbruist node snack.js volgorde kipcorn 40
//
// Eenheid: 'stuk' (default) telt losse snacks, 'persoon' telt porties — het
// formulier vraagt dan "voor hoeveel personen?" in plaats van "hoeveel?".
//
// Prijzen altijd in CENTEN (275 = € 2,75). De wijziging is meteen live;
// de container hoeft niet herstart te worden.

const db_ = require('./db');

function euro(cent) {
  return '€ ' + (cent / 100).toFixed(2).replace('.', ',');
}

function toonLijst(db) {
  const rijen = db.prepare('SELECT * FROM snack ORDER BY volgorde, naam').all();
  if (!rijen.length) { console.log('Geen snacks in de database.'); return; }
  console.log('volgorde  slug            naam                 prijs        per        status');
  console.log('---------------------------------------------------------------------------');
  for (const r of rijen) {
    console.log(
      String(r.volgorde).padStart(8) + '  ' +
      r.slug.padEnd(15) + ' ' +
      r.naam.padEnd(20) + ' ' +
      euro(r.prijs_cent).padEnd(12) + ' ' +
      (r.eenheid || 'stuk').padEnd(10) + ' ' +
      (r.actief ? 'actief' : 'uit')
    );
  }
  const besteld = db.prepare(
    'SELECT s.slug, SUM(r.aantal) AS n FROM bestelregel r JOIN snack s ON s.id = r.snack_id GROUP BY s.slug'
  ).all();
  if (besteld.length) {
    console.log('\nAl besteld: ' + besteld.map((b) => b.slug + '=' + b.n).join(', ') +
      '  (uitzetten laat bestaande bestellingen ongemoeid)');
  }
}

function zoek(db, slug) {
  const r = db.prepare('SELECT * FROM snack WHERE slug = ?').get(slug);
  if (!r) {
    console.error('Onbekende slug: ' + slug + '. Bekijk de lijst met: node snack.js lijst');
    process.exit(1);
  }
  return r;
}

function centenUit(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0) {
    console.error('Prijs moet een geheel aantal centen zijn (275 = € 2,75), niet: ' + v);
    process.exit(1);
  }
  if (n > 5000) console.error('Let op: ' + euro(n) + ' — heb je euro\'s ingevuld in plaats van centen?');
  return n;
}

function eenheidUit(v) {
  if (v === 'persoon' || v === 'personen') return 'persoon';
  if (v === 'stuk' || v === 'stuks') return 'stuk';
  console.error("Eenheid moet 'stuk' of 'persoon' zijn, niet: " + v);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);

  // --per stuk|persoon mag overal staan; de rest blijft positioneel.
  let perVlag = null;
  const i = argv.indexOf('--per');
  if (i >= 0) {
    perVlag = eenheidUit(argv[i + 1]);
    argv.splice(i, 2);
  }

  const [commando, ...rest] = argv;
  const db = db_.open();
  db_.initSchema(db);

  switch (commando) {
    case 'lijst':
    case undefined:
      toonLijst(db);
      break;

    case 'toevoegen': {
      const [slug, naam, prijs, volgorde] = rest;
      if (!slug || !naam || prijs === undefined) {
        console.error('Gebruik: node snack.js toevoegen <slug> "<naam>" <prijs-in-centen> [volgorde]');
        process.exit(1);
      }
      if (!/^[a-z0-9-]+$/.test(slug)) {
        console.error('Slug mag alleen kleine letters, cijfers en streepjes bevatten: ' + slug);
        process.exit(1);
      }
      if (db.prepare('SELECT 1 FROM snack WHERE slug = ?').get(slug)) {
        console.error('Bestaat al: ' + slug + '. Prijs wijzigen doe je met: node snack.js prijs ' + slug + ' <centen>');
        process.exit(1);
      }
      const cent = centenUit(prijs);
      const vol = volgorde === undefined
        ? (db.prepare('SELECT COALESCE(MAX(volgorde),0) + 10 AS v FROM snack').get().v)
        : parseInt(volgorde, 10) || 0;
      const eenheid = perVlag || 'stuk';
      db.prepare('INSERT INTO snack (slug, naam, omschrijving, prijs_cent, eenheid, actief, volgorde) ' +
        "VALUES (?, ?, '', ?, ?, 1, ?)").run(slug, naam, cent, eenheid, vol);
      console.log('Toegevoegd: ' + naam + ' (' + slug + ') ' + euro(cent) + ' per ' + eenheid +
        ', volgorde ' + vol + ' — meteen live.');
      break;
    }

    case 'prijs': {
      const [slug, prijs] = rest;
      if (!slug || prijs === undefined) {
        console.error('Gebruik: node snack.js prijs <slug> <prijs-in-centen>');
        process.exit(1);
      }
      const oud = zoek(db, slug);
      const cent = centenUit(prijs);
      db.prepare('UPDATE snack SET prijs_cent = ? WHERE slug = ?').run(cent, slug);
      console.log(oud.naam + ': ' + euro(oud.prijs_cent) + ' -> ' + euro(cent) +
        '. Al geplaatste bestellingen houden de oude prijs.');
      break;
    }

    case 'uit': {
      const [slug] = rest;
      const r = zoek(db, slug);
      db.prepare('UPDATE snack SET actief = 0 WHERE slug = ?').run(slug);
      console.log(r.naam + ' staat uit — verdwijnt uit het bestelformulier, bestaande bestellingen blijven staan.');
      break;
    }

    case 'aan': {
      const [slug] = rest;
      const r = zoek(db, slug);
      db.prepare('UPDATE snack SET actief = 1 WHERE slug = ?').run(slug);
      console.log(r.naam + ' staat weer aan (' + euro(r.prijs_cent) + ').');
      break;
    }

    case 'naam': {
      const [slug, naam] = rest;
      if (!slug || !naam) { console.error('Gebruik: node snack.js naam <slug> "<nieuwe naam>"'); process.exit(1); }
      const r = zoek(db, slug);
      db.prepare('UPDATE snack SET naam = ? WHERE slug = ?').run(naam, slug);
      console.log(r.naam + ' heet nu ' + naam + '.');
      break;
    }

    case 'eenheid': {
      const [slug, waarde] = rest;
      if (!slug || (waarde === undefined && !perVlag)) {
        console.error('Gebruik: node snack.js eenheid <slug> stuk|persoon');
        process.exit(1);
      }
      const r = zoek(db, slug);
      const nieuw = perVlag || eenheidUit(waarde);
      db.prepare('UPDATE snack SET eenheid = ? WHERE slug = ?').run(nieuw, slug);
      console.log(r.naam + ' wordt nu geteld per ' + nieuw +
        (nieuw === 'persoon' ? " — het formulier vraagt 'voor hoeveel personen?'" : " — het formulier vraagt 'hoeveel?'") +
        '. Al geplaatste bestellingen houden hun aantal.');
      break;
    }

    case 'volgorde': {
      const [slug, n] = rest;
      if (!slug || n === undefined) { console.error('Gebruik: node snack.js volgorde <slug> <getal>'); process.exit(1); }
      const r = zoek(db, slug);
      db.prepare('UPDATE snack SET volgorde = ? WHERE slug = ?').run(parseInt(n, 10) || 0, slug);
      console.log(r.naam + ' staat nu op volgorde ' + (parseInt(n, 10) || 0) + '.');
      break;
    }

    default:
      console.error('Onbekend commando: ' + commando);
      console.error('Gebruik: lijst | toevoegen | prijs | aan | uit | naam | eenheid | volgorde');
      process.exit(1);
  }
}

main();
