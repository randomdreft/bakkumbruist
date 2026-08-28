'use strict';

// Integratietest voor de bestelpoortwachter: een bestelling zonder snacks
// wordt server- én client-side geweigerd.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, metServer, JSON_HEADERS, meldAan, draai } = require('./helpers');

draai('lege bestellingen worden server- en client-side geweigerd.', () => metServer(async ({ api }) => {
  const aanmelding = await meldAan(api, 77);
  assert.equal(aanmelding.status, 200);

  const leeg = await api('/api/bestelling', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ huisnummer: 77, regels: [] }),
  });
  assert.equal(leeg.status, 400);
  assert.equal(leeg.body.error, 'lege_bestelling');

  const snacks = await api('/api/snacks');
  const geldig = await api('/api/bestelling', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({
      huisnummer: 77,
      regels: [{ snack_id: snacks.body.snacks[0].id, aantal: 1 }],
    }),
  });
  assert.equal(geldig.status, 200);

  // Een lege inzending mag een bestaande bestelling niet wissen.
  const legeUpdate = await api('/api/bestelling', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ huisnummer: 77, regels: [] }),
  });
  assert.equal(legeUpdate.status, 400);
  assert.equal(legeUpdate.body.error, 'lege_bestelling');

  const status = await api('/api/bestelstatus?huisnummer=77');
  assert.equal(status.status, 200);
  assert.equal(status.body.bestelling.regels.length, 1);

  const clientCode = fs.readFileSync(path.join(ROOT, 'eten.js'), 'utf8');
  assert.match(clientCode, /if \(!regels\.length\) \{\s*bestelError\.textContent/);
}));
