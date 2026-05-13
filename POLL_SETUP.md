# Datum-poll setup — Google Sheet als backend

De poll op de homepage stuurt stemmen via `fetch` naar een Google Apps Script Web App die de stem in een Google Sheet schrijft. Dit document beschrijft de **eerste setup** en de **operationele flow**.

> Voor de huidige live deployment is dit al gedaan. Lees deze doc als je de poll van scratch wilt opzetten of weet wilt hebben wat er onder de motorkap gebeurt.

## Architectuur

```
Browser              Apps Script (Google)        Google Sheet
─────────            ──────────────────────      ──────────────
script.js ── POST ── doPost(e) ──── append/update ─── Stemmen-tab
   ↑                  validate                          A timestamp
   │                  dedupe-check                      B voorkeursdatum
   └─ JSON response ──┘                                 C huisnummer
       {status:"ok"|"updated"|"duplicate"|"error"}      D email
                                                       E user_agent
```

Geen captcha, geen account-login, geen e-mailverificatie. Bewust laag-drempelig — dit is een richtinggevende buurtpijling, geen verkiezing.

## Initiële setup (5 stappen)

### 1. Maak een Google Sheet

1. Ga naar [sheets.new](https://sheets.new) en maak een nieuw sheet aan onder het Google-account dat eigenaar moet zijn.
2. Hernoem het tabblad onderin (dubbelklik op "Blad1") naar **`Stemmen`** — exact deze naam, het script zoekt 'm op (zie `SHEET_NAME` in `apps-script.gs`).
3. Headers worden bij de eerste stem automatisch aangemaakt; je hoeft ze niet handmatig in te vullen. Voor de duidelijkheid:

   | A | B | C | D | E |
   |---|---|---|---|---|
   | timestamp | voorkeursdatum | huisnummer | email | user_agent |

4. Hernoem het bestand linksboven naar bijvoorbeeld **"Bakkum Bruist 2026 — datum-poll"**.

### 2. Plak het Apps Script

1. In het sheet: **Extensies → Apps Script** (opent nieuw tabblad).
2. Verwijder de standaard `function myFunction() {}`-stub.
3. Plak de volledige inhoud van [`apps-script.gs`](./apps-script.gs).
4. Sla op (**Ctrl+S** of het diskette-icoon).
5. Hernoem het project linksboven naar "Bakkum Bruist poll webhook".

### 3. Deploy als Web App

1. Rechtsboven: **Deploy → New deployment**.
2. Klik op het tandwiel-icoon naast "Select type" → kies **Web app**.
3. Vul in:
   - **Description:** `Bakkum Bruist datum-poll v1`
   - **Execute as:** `Me (jouw account)`
   - **Who has access:** **`Anyone`** *(vereist voor anonieme POSTs; er staan geen geheimen in dit script)*
4. Klik **Deploy**.
5. Google vraagt om autorisatie:
   - **Authorize access** → kies je account
   - Bij "Google hasn't verified this app": **Advanced** → **Go to … (unsafe)** (het is jouw eigen script)
   - **Allow**
6. Kopieer de **Web app URL** — eindigt op `/exec`.

> **Snelle smoke-test:** open de URL in je browser. Verwacht: `{"status":"error","message":"POST only"}`. Krijg je iets anders, dan klopt de deploy niet.

### 4. Plak de URL in `script.js`

Vervang de waarde van `WEBHOOK_URL` bovenin [`script.js`](./script.js):

```js
var WEBHOOK_URL = '<<GOOGLE_SHEET_WEBHOOK_URL>>';
// wordt:
var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Sync `/var/www/bakkumbruist/` → `/home/randal/bakkumbruist-repo/` en push naar GitHub.

### 5. End-to-end testen

1. Refresh https://bakkumbruist.nl (Ctrl+Shift+R)
2. Vul een geldig huisnummer in (oneven 1–77 of even 2–28) + kies een datum → **Stem versturen**
3. Verwacht: success-callout *"Bedankt voor je stem!"*
4. Open het sheet → er hoort een rij bij te staan
5. Probeer met hetzelfde huisnummer opnieuw te stemmen, maar kies de andere datum → verwacht: *"Voor nummer X is al gestemd op zaterdag … 2026. Wil je je stem wijzigen naar …?"*
6. Klik **Stem bijwerken** → de bestaande rij wordt overschreven (niet een tweede rij toegevoegd)

## Apps Script protocol

### Request
```json
POST /exec
Content-Type: text/plain;charset=utf-8
{
  "datum": "2026-09-12",
  "huisnummer": 17,
  "email": "buur@voorbeeld.nl",
  "update": true   // optioneel; forceer overschrijven van bestaande stem
}
```

### Responses
| status | Wanneer | Frontend gedrag |
|---|---|---|
| `ok` | Nieuwe stem opgeslagen | Toon "Bedankt voor je stem!" |
| `updated` | Bestaande rij overschreven (na `update: true`) | Toon "Je stem is bijgewerkt!" |
| `duplicate` | Huisnummer staat al in sheet, geen update-flag | Toon bevestigingsprompt met `existing_datum` |
| `error` | Validatie mislukt of exception | Toon netwerkfout-melding |

Bij `duplicate` retourneert het script ook `existing_datum` (de eerder gekozen datum). Sheets parseert kolom B vaak als Date-cel, dus dit kan teruggegeven worden als JavaScript Date-string (bv. `Sat Sep 12 2026 …`). De frontend (`datumLabel()` in `script.js`) parseert dat terug naar een lookup in `DATUM_LABELS` en toont een nette NL-string.

### Validatie

Server-side checks (in `apps-script.gs`):

- `datum` moet in de witelijst staan (`isValidDatum()`)
- `huisnummer` moet oneven 1–77 of even 2–28 zijn (`isValidHuisnummer()`)
- Body moet valide JSON zijn

Frontend-side checks (in `script.js`):

- Huisnummer-regex + range
- E-mail-regex (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` — strenger dan browser default die `test@test` zou accepteren)

## Onderhouds-flows

### Datum-opties wijzigen

Hardcoded op drie plekken — zorg dat ze synchroon blijven:

1. **`index.html`** — `<label class="poll-option">`-blokken (één per datum, met value, title, desc, tradeoff-lijst)
2. **`script.js`** — `DATUM_LABELS`-map (ISO → mens-leesbare string)
3. **`apps-script.gs`** — `isValidDatum()` array → **na elke wijziging hier: Apps Script opnieuw deployen** (zie hieronder)

### Apps Script-wijziging deployen

Wijzigingen in `apps-script.gs` zijn **niet** automatisch live; de bestaande Web App URL serveert nog de oude versie. Om bij te werken:

1. Plak de nieuwe `apps-script.gs` in de Apps Script editor
2. **Ctrl+S** (opslaan)
3. **Deploy → Manage deployments**
4. Klik op het potlood ✏️ naast de bestaande deployment
5. Bij **Version**: kies **New version**
6. **Deploy**
7. De URL blijft hetzelfde — geen wijziging nodig in `script.js`

### Stem-bezit overzichtelijk

In een vrije cel in de sheet (bv. `G1`):

```
=QUERY(B:B; "select B, count(B) where B is not null group by B label count(B) 'stemmen'"; 1)
```

Geeft een live telling per datum.

### Stem-records verwijderen / corrigeren

Veilig om handmatig te doen in de sheet:

- **Rij verwijderen:** rechts-klik op rijnummer → "Rij verwijderen". Bij volgende stem met datzelfde huisnummer wordt het als nieuwe stem behandeld.
- **Rij wijzigen:** edit de cellen direct in de sheet. Verandert niets aan toekomstige polls — het script kijkt alleen bij dubbele-detectie naar kolom C (huisnummer).

### Poll sluiten

Twee opties:

1. **Soft close** — verwijder de Apps Script deployment via **Deploy → Manage deployments → 🗑️**. De fetch faalt; frontend toont netwerkfout. Cleanste optie, geen frontend-deploy nodig.
2. **Hard close** — vervang de poll-sectie in `index.html` door een "Save the date"-blok met de geprikte datum.

## Lokaal testen zonder echte sheet

Snelle mock zonder Apps Script-account:

```bash
cd /var/www/bakkumbruist && python3 -m http.server 8000
# open http://localhost:8000
```

In de DevTools-console:

```js
window.fetch = function(url, opts){
  console.log('mock POST', url, opts.body);
  return Promise.resolve({
    ok: true,
    json: function(){ return Promise.resolve({ status: 'ok' }); }
  });
};
```

Vervang `'ok'` door `'duplicate'` (en voeg `existing_datum: '2026-09-12'` toe) om die flow te testen, of door `'updated'` voor de wijziging-flow.

## Veiligheid en privacy

- Geen captcha, geen tracking, geen externe scripts behalve de fetch naar de sheet-webhook
- Geen cookies — alles werkt zonder consent banner
- E-mailadressen blijven in de sheet, worden nergens anders gedeeld
- Apps Script draait onder het account van de deployer met de minimale spreadsheet-toegang die nodig is

## Hardcoded waarden

| Constante | Bestand | Huidige waarde |
|---|---|---|
| `WEBHOOK_URL` | `script.js` | `https://script.google.com/macros/s/AKfyc.../exec` |
| `CONTACT_EMAIL` | `script.js` | `slems_verenigd1q@icloud.com` |
| `DATUM_LABELS` | `script.js` | `2026-09-12`, `2026-09-26` |
| `SHEET_NAME` | `apps-script.gs` | `Stemmen` |
| `isValidDatum()` | `apps-script.gs` | `[2026-09-12, 2026-09-26]` |
| `isValidHuisnummer()` | `apps-script.gs` | oneven 1–77, even 2–28 |
