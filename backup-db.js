'use strict';

// Maakt een consistente kopie van de database naar één bestand.
//
// Nodig omdat SQLite in WAL-modus draait: het .db-bestand alleen kopiëren
// mist alles wat nog in bakkumbruist.db-wal staat. VACUUM INTO schrijft de
// volledige, actuele staat weg in één bestand, terwijl de site door kan
// draaien — geen downtime, geen half geschreven backup.
//
//   sudo docker exec bakkumbruist node /app/backup-db.js /tmp/bb.db
//   sudo docker exec bakkumbruist cat /tmp/bb.db > ~/bakkumbruist-$(date +%F).db
//   sudo docker exec bakkumbruist rm -f /tmp/bb.db

const fs = require('fs');
const db_ = require('./db');

const doel = process.argv[2];
if (!doel) {
  console.error('Gebruik: node backup-db.js <doelbestand>');
  process.exit(1);
}

// VACUUM INTO weigert een bestaand bestand te overschrijven.
try { fs.unlinkSync(doel); } catch (e) { /* bestond niet */ }

const db = db_.open();
db.exec("VACUUM INTO '" + doel.replace(/'/g, "''") + "'");

const stat = fs.statSync(doel);
const n = db.prepare('SELECT COUNT(*) AS n FROM aanmelding').get().n;
const b = db.prepare('SELECT COUNT(*) AS n FROM bestelling').get().n;
console.error('Backup: ' + doel + ' (' + stat.size + ' bytes, ' +
  n + ' aanmeldingen, ' + b + ' bestellingen)');
