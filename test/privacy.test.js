'use strict';

// Er zit geen login op het bestellen: iedereen kan elk huisnummer invullen.
// /api/bestelstatus mag daarom niets teruggeven wat je niet aan een vreemde
// zou vertellen — geen namen, geen contactgegevens en geen aantallen.

const assert = require('node:assert/strict');
const { metServer, JSON_HEADERS, meldAan, draai } = require('./helpers');

const VERBODEN = ['naam', 'contact', 'dag_personen', 'avond_personen', 'deelnemers', 'opmerking'];

draai('bestelstatus lekt geen namen, contactgegevens of aantallen.', () => metServer(async ({ api }) => {
  // Een huis dat zich met naam en contactgegevens heeft aangemeld.
  const aanmelding = await api('/api/aanmelding', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({
      huisnummer: 71,
      komt: 'ja',
      naam: 'Familie Testman',
      contact: 'test@example.org',
      deelnemers: { dag: { volwassen: 2, tm8: 2 }, avond: { volwassen: 1 } },
    }),
  });
  assert.equal(aanmelding.status, 200);

  const status = await api('/api/bestelstatus?huisnummer=71');
  assert.equal(status.status, 200);
  assert.equal(status.body.mag, true);

  const plat = JSON.stringify(status.body);
  for (const veld of VERBODEN) {
    assert.ok(!(veld in status.body), 'bestelstatus mag geen veld "' + veld + '" bevatten');
  }
  assert.doesNotMatch(plat, /Testman|test@example\.org/,
    'bestelstatus mag naam noch contactgegevens bevatten');

  // Ook het formulier zelf mag geen aantallen uit de aanmelding tonen.
  const { ROOT } = require('./helpers');
  const clientCode = require('node:fs').readFileSync(require('node:path').join(ROOT, 'eten.js'), 'utf8');
  assert.doesNotMatch(clientCode, /dag_personen|dagPersonen/,
    'eten.js mag het aantal dagdeelnemers niet meer opvragen of tonen');

  // Hetzelfde voor een huis dat niet mag bestellen: alleen een reden, geen data.
  await meldAan(api, 73);
  const anderHuis = await api('/api/bestelstatus?huisnummer=1');
  assert.equal(anderHuis.body.reden, 'geen_aanmelding');
  for (const veld of VERBODEN) {
    assert.ok(!(veld in anderHuis.body), 'bestelstatus mag geen veld "' + veld + '" bevatten');
  }
}));
