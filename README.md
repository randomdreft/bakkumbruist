# Bakkum Bruist 2026 — Eikenhorst

Single-page site voor het buurtfeest op de Eikenhorst in Bakkum (gemeente Castricum), met een officieel aanmeldformulier en een beveiligde overzichtspagina voor de organisatie.

**Live:** [bakkumbruist.nl](https://bakkumbruist.nl) · **Datum:** zaterdag 12 september 2026

## Tech

Plain HTML/CSS/JS aan de voorkant (geen framework, geen bundler, geen externe fonts of trackers) + een kleine **zero-dependency Node-server** (`server.js`) die zowel de statische bestanden serveert als de aanmeldingen verwerkt. Opslag is één JSON-bestand op een persistent Docker-volume — bewust simpel, in lijn met de tobygames-server in dezelfde `static-sites`-stack. Geen Google Sheets meer.

## Structuur

```
.
├── index.html         single page (hero, idee, datum, activiteiten, aanmeldformulier + teller, doe mee)
├── styles.css         huisstijl + alternerende secties + formulier/teller-styling
├── script.js          jaartal, openbare teller, aanmeld-logica (steppers, kom-je-toggle, verzenden)
├── aanmeldingen.html  beveiligde overzichtspagina voor de organisatie (noindex)
├── server.js          Node http-server: static files + API + opslag (geen npm-dependencies)
├── Dockerfile         node:22-alpine, draait server.js op poort 80
├── package.json       alleen een dev-script voor lokaal draaien
├── favicon.png
└── huisstijl/         logo-varianten
```

## Backend & opslag

De server (`server.js`) draait in de `bakkumbruist`-container (build-based) in `/opt/static-sites/docker-compose.yml`:

- `/var/www/bakkumbruist` → `/static` (read-only) — de site
- named volume `bakkumbruist-data` → `/data` — de aanmeldingen (`/data/aanmeldingen.json`)

**Endpoints:**

| Route | Methode | Auth | Doel |
|-------|---------|------|------|
| `/api/aanmelding` | POST | nee | Aanmelding opslaan/bijwerken (upsert per huisnummer) |
| `/api/teller` | GET | nee | Publiek getal: aantal "komt = ja"-adressen (geen persoonsgegevens) |
| `/aanmeldingen` | GET | **ja** | Dashboard voor de organisatie (todo-tracker + overzicht) |
| `/api/aanmeldingen` | GET | **ja** | Volledige data + 3-staten-totalen + ontbrekende huisnummers (JSON) |
| `/api/aanmeldingen.csv` | GET | **ja** | Download als CSV (`;`-gescheiden, UTF-8 BOM) |
| `/api/mondeling` | POST | **ja** | Adres als afgemeld markeren (`{huisnummer}`) — voegt een komt:false-record toe |
| `/api/mondeling` | DELETE | **ja** | Mondelinge afmelding ongedaan maken (`{huisnummer}`) |

### Dashboard & afmeldingen

Het dashboard rekent met **drie statussen die altijd optellen tot 53**: *aangemeld* (komt = ja), *afgemeld* (komt = nee) en *onbekend* (nog niets laten horen). Bovenaan staat een todo-tracker met die drie getallen + een gestapelde voortgangsbalk, zodat in één oogopslag zichtbaar is hoeveel adressen nog benaderd moeten worden.

Adressen die zich persoonlijk afmelden (niet via het formulier) markeert de organisatie met één klik in de lijst **Nog te benaderen**; dat schuift ze van *onbekend* naar *afgemeld*. Zo'n markering wordt opgeslagen als een gewoon **komt:false-record** in dezelfde lijst (met een intern `bron: 'mondeling'`-vlaggetje) en verschijnt als *nee* bij **Alle reacties** — dus geen aparte boekhouding. Bij die rij staat **ongedaan maken** om de markering terug te draaien; gewone formulier-reacties zijn niet via die knop te verwijderen (HTTP 404). Een adres dat al reageerde kan niet opnieuw worden gemarkeerd (HTTP 409).

**Geldige huisnummers Eikenhorst** (hardcoded in `server.js` én `script.js`): oneven 1–77 en even 2–28, samen 53 adressen. De server-side check is de waterdichte laag.

**Auth:** HTTP Basic Auth op alle `/aanmeldingen*`-routes (gebruiker + wachtwoord). Het wachtwoord komt uit de omgevingsvariabele `AANMELDINGEN_WACHTWOORD`, die in `/opt/static-sites/.env` (chmod 600) staat — **niet** in deze repo. Wachtwoord wijzigen:

```bash
sudo sed -i 's/^AANMELDINGEN_WACHTWOORD=.*/AANMELDINGEN_WACHTWOORD=NIEUW/' /opt/static-sites/.env
cd /opt/static-sites && sudo docker compose up -d bakkumbruist
```

## Data bekijken, back-uppen, resetten

```bash
# Bekijken (op de host)
sudo docker exec bakkumbruist cat /data/aanmeldingen.json

# Back-up maken
sudo docker exec bakkumbruist cat /data/aanmeldingen.json > ~/aanmeldingen-backup.json

# Resetten (alles wissen)
sudo docker exec bakkumbruist sh -c 'rm -f /data/aanmeldingen.json' && sudo docker restart bakkumbruist
```

Alle reacties (aanmeldingen, formulier-afmeldingen én mondelinge afmeldingen) staan in één bestand `aanmeldingen.json`. *(Het oude losse `mondeling.json` is bij het opstarten eenmalig in deze lijst gevouwen en daarna verwijderd.)*

De data zit in het Docker-volume `static-sites_bakkumbruist-data`. Het TROGDOR-backupscript (`/usr/local/sbin/trogdor-backup.sh`, dagelijks 03:00) dumpt `aanmeldingen.json` als `content/bakkumbruist-aanmeldingen.json` in de dagelijkse backup (GFS-retentie, daarna naar de NAS). De oude poll-data stond in een losse Google Sheet en is niet meer in gebruik; die mag weg.

## Secties (in volgorde)

1. **Hero** *(wit)* — logo, "De datum is geprikt"-badge, CTA `Meld je aan` + WhatsApp
2. **Wat is Bakkum Bruist?** *(duinzand)*
3. **De datum staat vast** *(wit)* — datum-badge 12 sep + uitleg waarom
4. **Dit willen we sowieso doen** *(duinzand)* — activiteitenlijst (stormbaan onder voorbehoud)
5. **Meld je aan** *(wit)* — openbare teller + aanmeldformulier
6. **Doe mee** *(duinzand)* — comité + WhatsApp + mailcontact

## Lokaal draaien

```bash
cd /var/www/bakkumbruist && npm run dev    # http://localhost:8000, data in ./.data
```

(De server leest `PORT`, `STATIC_DIR` en `DATA_DIR` uit de omgeving; in de container zijn dat 80, `/static` en `/data`.)

## Deploy-workflow

```bash
# 1. Edit live in /var/www/bakkumbruist/
# 2. Bij wijziging van server.js / Dockerfile: container herbouwen
cd /opt/static-sites && sudo docker compose up -d --build bakkumbruist
#    (puur HTML/CSS/JS wijzigen werkt direct — /static is een live read-only mount)
# 3. Kopieer naar de repo en push (alles in het Nederlands)
cp -r /var/www/bakkumbruist/* /home/randal/bakkumbruist-repo/
cd /home/randal/bakkumbruist-repo && git add -A && git commit && git push
```

De daily update-cron (`trogdor-pull-updates.sh`) bouwt deze container automatisch mee, omdat `build_stack tobygames /opt/static-sites` de hele stack-map bouwt.

## Status

- ✅ Datum geprikt: zaterdag 12 september 2026
- ✅ Aanmeldformulier live (per huishouden, upsert, komt/komt-niet, leeftijdsgroepen)
- ✅ Eigen opslag op de server (JSON op Docker-volume), Google Sheet uitgefaseerd
- ✅ Openbare teller (alleen unieke "komt = ja"-adressen)
- ✅ Beveiligd dashboard `/aanmeldingen`: todo-tracker (aangemeld / afgemeld / onbekend), totalen, mondelinge afmeldingen als gewone "nee" in de lijst (één klik, ongedaan te maken) en CSV-export
- ⏳ Bijdrage (tikkie) wordt later apart gecommuniceerd
