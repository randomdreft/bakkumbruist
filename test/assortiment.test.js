'use strict';

// Het assortiment is zoals het is: het bestelformulier heeft geen
// opmerkingveld meer, de server neemt er geen aan, de burgers dragen zelf de
// mededeling dat er niets aan te veranderen valt, en de kipnuggets zeggen in
// hun naam én omschrijving dat een bestelling een bakje van zes is.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, metServer, JSON_HEADERS, meldAan, draai } = require('./helpers');

draai('assortiment: geen opmerkingveld, burgers zonder maatwerk, nuggets per bakje van 6.', () => metServer(async ({ api }) => {
  // --- Het formulier zelf ---
  const html = fs.readFileSync(path.join(ROOT, 'eten.html'), 'utf8');
  assert.doesNotMatch(html, /f-opmerking|name="opmerking"|<textarea/,
    'eten.html mag geen opmerkingveld meer bevatten');

  const clientCode = fs.readFileSync(path.join(ROOT, 'eten.js'), 'utf8');
  assert.doesNotMatch(clientCode, /opmerking/,
    'eten.js mag geen opmerking meer versturen of tonen');

  // --- Het assortiment ---
  const snacks = await api('/api/snacks');
  assert.equal(snacks.status, 200);
  const perSlug = new Map(snacks.body.snacks.map((s) => [s.slug, s]));

  const hamburger = perSlug.get('hamburger');
  assert.ok(hamburger, 'hamburger hoort op de kaart te staan');
  assert.equal(hamburger.prijs_cent, 675);
  assert.equal(hamburger.eenheid, 'stuk');
  assert.ok(hamburger.omschrijving.length > 0,
    'de hamburger moet zelf melden dat er niets aan te passen valt');

  const vegaburger = perSlug.get('vegaburger');
  assert.ok(vegaburger, 'vegaburger hoort op de kaart te staan');
  assert.equal(vegaburger.prijs_cent, 825);
  assert.equal(vegaburger.eenheid, 'stuk');
  assert.ok(vegaburger.omschrijving.length > 0,
    'de vegaburger moet zelf melden dat er niets aan te passen valt');

  // Kipnuggets gaan per bakje van zes. Het aantal moet in de naam staan, want
  // die is het enige wat de kolomkoppen, de CSV en de lijst voor De Toren
  // bereikt; de omschrijving rekent het op het formulier nog eens voor.
  const nuggets = perSlug.get('kipnuggets');
  assert.ok(nuggets, 'kipnuggets horen op de kaart te staan');
  assert.equal(nuggets.prijs_cent, 475);
  assert.equal(nuggets.eenheid, 'bakje',
    'de prijs is per bakje, niet per nugget — dat moet de eenheid zeggen');
  assert.equal(nuggets.woorden.per, 'per bakje');
  assert.match(nuggets.naam, /6/, 'het aantal per bakje hoort in de naam te staan');
  assert.match(nuggets.omschrijving, /6.*12|12.*6/s,
    'de omschrijving moet voorrekenen dat 2 bakjes 12 nuggets zijn');

  // --- De server neemt geen opmerking meer aan ---
  assert.equal((await meldAan(api, 75)).status, 200);
  const besteld = await api('/api/bestelling', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({
      huisnummer: 75,
      regels: [{ snack_id: hamburger.id, aantal: 2 }],
      opmerking: 'zonder ui graag',
    }),
  });
  assert.equal(besteld.status, 200);
  assert.equal(besteld.body.bestelling.totaal_cent, 1350);
  assert.equal(besteld.body.bestelling.opmerking, undefined,
    'de publieke bestelstatus geeft geen opmerking meer terug');

  const status = await api('/api/bestelstatus?huisnummer=75');
  assert.equal(status.body.bestelling.opmerking, undefined);
}));
