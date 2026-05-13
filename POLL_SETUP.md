# Datum-poll setup — Google Sheet als backend

De poll op de homepage stuurt stemmen naar een Google Apps Script dat
de stem in een Google Sheet schrijft. Hieronder de 5-stappen-handleiding.

## 1. Maak een Google Sheet

1. Ga naar [sheets.new](https://sheets.new) en maak een nieuw sheet.
2. Hernoem het tabblad naar **`Stemmen`** (zie `SHEET_NAME` in
   `apps-script.gs` — pas hier ook aan als je een andere naam wilt).
3. Vul rij 1 met deze headers (of laat het script het bij eerste stem doen):

   | A | B | C | D | E |
   |---|---|---|---|---|
   | timestamp | datum | huisnummer | email | user_agent |

4. Hernoem het bestand naar bijvoorbeeld **"Bakkum Bruist 2026 — datum-poll"**.

## 2. Plak het Apps Script

1. In het sheet: **Extensies → Apps Script**.
2. Verwijder de standaard `function myFunction() {}`-stub.
3. Plak de volledige inhoud van [`apps-script.gs`](./apps-script.gs).
4. Sla op (💾 of `Ctrl+S`). Hernoem het project naar bijvoorbeeld
   "Bakkum Bruist poll webhook".

## 3. Deploy als Web App

1. Klik rechtsboven op **Deploy → New deployment**.
2. Klik op het tandwiel naast "Select type" en kies **Web app**.
3. Vul in:
   - **Description**: `Bakkum Bruist datum-poll v1`
   - **Execute as**: `Me (jouw account)`
   - **Who has access**: `Anyone`  *(let op: vereist voor anonieme POSTs;
     er staan geen geheimen in dit script)*
4. Klik **Deploy**. Google vraagt om autorisatie (je geeft het script
   toestemming om dit sheet te lezen/schrijven). Doorloop de
   "advanced → go to project (unsafe)"-flow als je dat scherm krijgt.
5. Kopieer de **Web app URL** (eindigt op `/exec`).

> Bij latere wijzigingen in het script: **Deploy → Manage deployments →
> potlood-icoon → Version: New version → Deploy**. De URL blijft hetzelfde.

## 4. Plak de URL in de site

In [`script.js`](./script.js), vervang de placeholder bovenin:

```js
var WEBHOOK_URL = '<<GOOGLE_SHEET_WEBHOOK_URL>>';
```

door de net gekopieerde Web App URL:

```js
var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Sync `/var/www/bakkumbruist/` → `/home/randal/bakkumbruist-repo/` en
push naar GitHub (zie wokflow in `CLAUDE.md`).

## 5. Test end-to-end

1. Open `https://bakkumbruist.nl` (of lokaal — zie onder).
2. Vul een geldig oneven (1–77) of even (2–28) huisnummer in en kies een datum.
3. Klik **Stem versturen**. Verwacht: success-callout met groene check.
4. Open het sheet en controleer dat de rij erbij staat
   (timestamp, datum, huisnummer, optioneel email, user_agent leeg).
5. Probeer met hetzelfde huisnummer opnieuw te stemmen (op een ander
   apparaat of na `localStorage.clear()` in DevTools). Verwacht:
   foutmelding met `status: duplicate`.

## Lokaal testen zonder echte sheet

Snelle mock zonder Apps Script-account:

1. Start een lokale HTTP-server in `/var/www/bakkumbruist/`:
   ```bash
   cd /var/www/bakkumbruist && python3 -m http.server 8000
   ```
2. Open `http://localhost:8000` en open DevTools.
3. In de console: forceer een mock fetch-respons:
   ```js
   window.fetch = function(url, opts){
     console.log('mock POST', url, opts.body);
     return Promise.resolve({
       ok: true,
       json: function(){ return Promise.resolve({ status: 'ok' }); }
     });
   };
   ```
   (Vervang `'ok'` door `'duplicate'` om die flow te testen.)
4. Vul het formulier in en check dat de success/duplicate-flow klopt.

## Wat er nog ingevuld moet worden

| Placeholder | Plek | Waarde |
|---|---|---|
| `<<GOOGLE_SHEET_WEBHOOK_URL>>` | `script.js` regel met `WEBHOOK_URL` | Web App URL uit stap 3 |
| `CONTACT_EMAIL` | `script.js` (al ingevuld als `slems_verenigd1q@icloud.com`) | wijzig als gewenst |

## Stemmen uitlezen

Open het sheet. Een snelle telling per datum-optie:

1. Maak ergens een vrije cel, bijvoorbeeld G1, en plak:
   ```
   =QUERY(B:B; "select B, count(B) where B is not null group by B label count(B) 'stemmen'"; 1)
   ```
2. Dit geeft een live telling per datum.

## Veiligheid en privacy

- Het script accepteert alleen POST met geldige datum en huisnummer.
- Geen captcha — bewuste keuze (richtinggevende pijling, geen verkiezing).
- E-mailadressen staan alleen in het sheet, niet ergens anders.
- Wil je de poll sluiten? Verwijder de deployment via
  **Deploy → Manage deployments → 🗑️**. De fetch zal dan falen en de
  frontend toont de netwerkfout-melding.
