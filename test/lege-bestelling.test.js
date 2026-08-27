'use strict';

// Zero-dependency integratietest voor de bestelpoortwachter. De server draait
// tegen een tijdelijke database; productiegegevens worden nooit aangeraakt.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function vrijePoort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function wachtOpServer(child) {
  return new Promise((resolve, reject) => {
    let uitvoer = '';
    const timer = setTimeout(() => reject(new Error('Server startte niet op tijd:\n' + uitvoer)), 5000);
    function klaar(chunk) {
      uitvoer += chunk.toString();
      if (uitvoer.includes('Bakkum Bruist server op poort')) {
        clearTimeout(timer);
        resolve();
      }
    }
    child.stdout.on('data', klaar);
    child.stderr.on('data', klaar);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Server stopte voortijdig met code ' + code + ':\n' + uitvoer));
    });
  });
}

async function api(port, pathname, opties) {
  const response = await fetch('http://127.0.0.1:' + port + pathname, opties);
  return { status: response.status, body: await response.json() };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakkumbruist-test-'));
  const port = await vrijePoort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      DATA_DIR: dataDir,
      STATIC_DIR: ROOT,
      BESTEL_DEADLINE: '2099-12-31T23:59:00+01:00',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await wachtOpServer(child);
    const headers = { 'Content-Type': 'application/json' };

    const aanmelding = await api(port, '/api/aanmelding', {
      method: 'POST', headers,
      body: JSON.stringify({
        huisnummer: 77,
        komt: 'ja',
        deelnemers: { dag: { volwassen: 1 }, avond: {} },
      }),
    });
    assert.equal(aanmelding.status, 200);

    const leegMetOpmerking = await api(port, '/api/bestelling', {
      method: 'POST', headers,
      body: JSON.stringify({ huisnummer: 77, regels: [], opmerking: 'Wel een opmerking' }),
    });
    assert.equal(leegMetOpmerking.status, 400);
    assert.equal(leegMetOpmerking.body.error, 'lege_bestelling');

    const snacks = await api(port, '/api/snacks');
    const geldig = await api(port, '/api/bestelling', {
      method: 'POST', headers,
      body: JSON.stringify({
        huisnummer: 77,
        regels: [{ snack_id: snacks.body.snacks[0].id, aantal: 1 }],
        opmerking: 'Geldige bestelling',
      }),
    });
    assert.equal(geldig.status, 200);

    const legeUpdate = await api(port, '/api/bestelling', {
      method: 'POST', headers,
      body: JSON.stringify({ huisnummer: 77, regels: [], opmerking: 'Mag bestaand niet wissen' }),
    });
    assert.equal(legeUpdate.status, 400);
    assert.equal(legeUpdate.body.error, 'lege_bestelling');

    const status = await api(port, '/api/bestelstatus?huisnummer=77');
    assert.equal(status.status, 200);
    assert.equal(status.body.bestelling.regels.length, 1);
    assert.equal(status.body.bestelling.opmerking, 'Geldige bestelling');

    const clientCode = fs.readFileSync(path.join(ROOT, 'eten.js'), 'utf8');
    assert.match(clientCode, /if \(!regels\.length\) \{\s*bestelError\.textContent/);

    console.log('OK: lege bestellingen worden server- en client-side geweigerd.');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
