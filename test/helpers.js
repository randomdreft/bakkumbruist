'use strict';

// Gedeelde testhulp: start server.js tegen een verse database in een tijdelijke
// map en praat er via HTTP mee. Geen dependencies, geen netwerk naar buiten,
// en de productiegegevens worden nooit aangeraakt.

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

// Start de server, draai fn({ api, port, dataDir }), ruim daarna altijd op.
async function metServer(fn, extraEnv) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakkumbruist-test-'));
  const port = await vrijePoort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      DATA_DIR: dataDir,
      STATIC_DIR: ROOT,
      BESTEL_DEADLINE: '2099-12-31T23:59:00+01:00',
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  async function api(pathname, opties) {
    const response = await fetch('http://127.0.0.1:' + port + pathname, opties);
    return { status: response.status, body: await response.json() };
  }

  try {
    await wachtOpServer(child);
    return await fn({ api: api, port: port, dataDir: dataDir });
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Meld een huis aan zodat het mag bestellen.
async function meldAan(api, huisnummer) {
  return api('/api/aanmelding', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({
      huisnummer: huisnummer,
      komt: 'ja',
      deelnemers: { dag: { volwassen: 1 }, avond: {} },
    }),
  });
}

function draai(naam, fn) {
  fn().then(() => {
    console.log('OK: ' + naam);
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { ROOT, metServer, JSON_HEADERS, meldAan, draai };
