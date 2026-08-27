# Bakkum Bruist 2026 — Eikenhorst

Single-page site voor het buurtfeest op de Eikenhorst in Bakkum (gemeente Castricum), met een officieel aanmeldformulier, een bestelformulier voor het eten en een beveiligde overzichtspagina voor de organisatie.

**Live:** [bakkumbruist.nl](https://bakkumbruist.nl) · **Datum:** zaterdag 12 september 2026

## Tech

Plain HTML/CSS/JS aan de voorkant (geen framework, geen bundler, geen externe fonts of trackers) + een kleine **zero-dependency Node-server** (`server.js`) die zowel de statische bestanden serveert als de aanmeldingen en bestellingen verwerkt. Opslag is **SQLite** via de ingebouwde `node:sqlite` van Node 22 — dus nog steeds geen npm-install en geen native build in de daily pipeline.

## Structuur

```
.
├── index.html         single page (hero, idee, datum, activiteiten, aanmeldformulier + teller, doe mee)
├── eten.html          bestelformulier voor het eten (/eten)
├── styles.css         huisstijl + alternerende secties + formulier/teller/bestel-styling
├── script.js          jaartal, openbare teller, aanmeld-logica (steppers, dag/avond, live bijdrage)
├── eten.js            bestel-logica (huisnummer opzoeken, snacks uit de database, live totaal)
├── aanmeldingen.html  beveiligde overzichtspagina voor de organisatie (noindex)
├── server.js          Node http-server: static files + API (geen npm-dependencies)
├── db.js              schema, seed en gedeelde constanten (huisnummers, leeftijdsgroepen, tarieven)
├── migreer-json.js    eenmalige migratie aanmeldingen.json -> SQLite, met zelfcontrole
├── snack.js           beheer van het snack-assortiment (toevoegen / prijs / aan / uit)
├── backup-db.js       consistente kopie van de database (VACUUM INTO, WAL-veilig)
├── Dockerfile         node:22-alpine, draait server.js op poort 80
├── package.json       dev-scripts voor lokaal draaien
├── favicon.png
└── huisstijl/         logo-varianten
```

## Datamodel

SQLite op `/data/bakkumbruist.db` (Docker-volume `static-sites_bakkumbruist-data`), met `PRAGMA foreign_keys = ON` en WAL.

| Tabel | Inhoud |
|-------|--------|
| `aanmelding` | één rij per huisnummer: `huisnummer` (UNIQUE), `komt`, `bron`, `naam`, `contact`, `opmerking`, `aangemaakt_op`, `bijgewerkt_op` |
| `deelnemer` | de aantallen: `aanmelding_id` (FK, CASCADE), `leeftijdsgroep` (`tm8`/`9_13`/`14_18`/`volwassen`), `deelname` (`dag`/`avond`), `aantal`. UNIQUE op (aanmelding, groep, deelname) |
| `snack` | het assortiment: `slug` (UNIQUE), `naam`, `omschrijving`, `prijs_cent`, `eenheid` (`stuk`/`persoon`), `actief`, `volgorde` |
| `bestelling` | één rij per huis: `aanmelding_id` (FK, UNIQUE), `opmerking`, tijdstempels |
| `bestelregel` | `bestelling_id` (FK, CASCADE), `snack_id` (FK), `aantal`, `prijs_cent_bij_bestelling`. UNIQUE op (bestelling, snack) |
| `meta` | sleutel/waarde, o.a. de markering dat de JSON-migratie gedaan is |

Drie keuzes die uitleg verdienen:

- **`deelnemer` is een aparte tabel, geen acht kolommen in `aanmelding`.** Een leeftijdsgroep of een tariefsoort erbij is dan een rij, geen schemawijziging.
- **`prijs_cent_bij_bestelling` is opzettelijk gedenormaliseerd.** Wijzigt De Toren de prijs nadat mensen besteld hebben, dan blijven de al verstuurde bevestigingen kloppen. Nieuwe bestellingen pakken vanzelf de nieuwe prijs.
- **`eenheid` staat in de data, niet in de teksten.** Snacks tel je per stuk, friet per persoon (één portie per persoon). Bij `persoon` vraagt het formulier *"Voor hoeveel personen?"* in plaats van *"Hoeveel?"*, en leest alles wat eruit komt als *"4 personen friet"* in plaats van *"4× Friet"* — ook de lijst die naar De Toren gaat. Een volgende snack die per persoon gaat, is dus één vlaggetje en geen tekstwijziging.

**`komt` is drie-standig** (`ja` / `nee` / `misschien`), niet 0/1: de organisatie kan een adres ook als *misschien* markeren. Overal expliciet vergelijken.

## Deelname en bijdrage

| Soort | Wat | Tarief per persoon |
|-------|-----|--------------------|
| `dag` | de hele dag, inclusief activiteiten en eten overdag | € 17,50 |
| `avond` | alleen het avondprogramma vanaf half acht | € 7,50 |

Eén huis mag beide gebruiken (bijvoorbeeld twee volwassenen de hele dag plus twee vrienden alleen 's avonds). De tarieven staan in `TARIEF_DAG_CENT` / `TARIEF_AVOND_CENT` in `/opt/static-sites/.env`; de site haalt ze op via `/api/instellingen` en heeft ze nergens hardcoded. De client rekent live mee ter informatie, **de server rekent het bedrag altijd zelf na**.

De bijdrage (feest) en de eetbestelling (De Toren) zijn **gescheiden potjes**. Op de organisatiepagina staan ze per huis apart naast elkaar; tel ze niet samen tot één bedrag zonder beide componenten te noemen.

## Endpoints

| Route | Methode | Auth | Doel |
|-------|---------|------|------|
| `/api/teller` | GET | nee | Publiek getal: aantal "komt = ja"-adressen (geen persoonsgegevens) |
| `/api/instellingen` | GET | nee | Tarieven, leeftijdsgroepen, besteldeadline, contactadres |
| `/api/snacks` | GET | nee | Actieve snacks met prijzen — hiermee bouwt het bestelformulier zichzelf |
| `/api/aanmelding` | POST | nee | Aanmelding opslaan/bijwerken (upsert per huisnummer) |
| `/api/bestelstatus?huisnummer=..` | GET | nee | Mag dit huis bestellen, en wat staat er nu? |
| `/api/bestelling` | POST | nee | Bestelling plaatsen/bijwerken (vervangt de regels in één transactie) |
| `/aanmeldingen` | GET | **ja** | Dashboard voor de organisatie |
| `/api/organisatie/overzicht` | GET | **ja** | Alle data + totalen + bestellijst (JSON) |
| `/api/organisatie/aanmeldingen.csv` | GET | **ja** | Aanmeldingen als CSV |
| `/api/organisatie/bestellingen.csv` | GET | **ja** | Bestellingen als CSV, met een TOTAAL-slotregel |
| `/api/mondeling` | POST/DELETE | **ja** | Adres markeren als *afgemeld* of *misschien*, en dat ongedaan maken |

> Auth-kolom = HTTP Basic Auth, **tenzij** het client-IP in `AANMELDINGEN_IP_WHITELIST` staat. De oude paden `/api/aanmeldingen(.csv)` blijven werken en vereisen dezelfde auth.

**Privacy.** Er is geen login voor bewoners; identificatie op huisnummer is genoeg voor een straatfeest. `/api/bestelstatus` geeft daarom bewust alleen terug of dit huis mag bestellen, waarom niet, en de eigen bestelregels — **nooit** namen, contactgegevens of aantallen van een ander huis.

## Toegangsregels voor het bestellen

Allemaal server-side afgedwongen, in deze volgorde:

1. Huisnummer niet in de lijst van 53 adressen → *"Dit nummer kennen we niet op de Eikenhorst"*
2. Geen aanmelding → eerst aanmelden, met een link naar het formulier
3. `komt = misschien` → eerst officieel aanmelden
4. `komt = nee` → *"Volgens onze administratie komen jullie dit jaar niet"*
5. Wel aangemeld maar **nul dagdeelnemers** → geen formulier; het eten wordt om half zes uitgedeeld en het avondprogramma begint pas om half acht
6. Deadline verstreken → readonly, met de al geplaatste bestelling zichtbaar

Verder valideert de server: aantallen als gehele getallen 0–20, snack-id's alleen tegen **actieve** snacks, en de prijs komt altijd uit de database (nooit uit wat de client meestuurt). Simpele rate-limiting per IP (30 schrijfacties per 10 minuten).

De statische server weigert bovendien bestandsnamen die op een kopietje wijzen (`.bak`, `.pre-`, `.orig`, `.old`, `~`, dotfiles). Zo'n kopie van `aanmeldingen.html` zou anders gewoon geserveerd worden: de auth-check matcht op het exacte pad. Vangnet in de code is betrouwbaarder dan onthouden dat je opruimt — **bewaar backups sowieso buiten `/var/www/bakkumbruist/`**, bijvoorbeeld in `~/bakkumbruist-backups/`.

## Het assortiment beheren

Het formulier, de overzichten en de CSV worden **volledig uit de `snack`-tabel opgebouwd**. Een snack toevoegen of uitzetten is dus één commando en verder niets — geen HTML, JS of query aanpassen. Wijzigingen zijn meteen live, de container hoeft niet herstart.

```bash
sudo docker exec bakkumbruist node snack.js lijst                          # wat staat er nu
sudo docker exec bakkumbruist node snack.js toevoegen kipcorn "Kipcorn" 250   # per stuk (prijs in CENTEN)
sudo docker exec bakkumbruist node snack.js toevoegen soep "Soep" 200 --per persoon
sudo docker exec bakkumbruist node snack.js prijs frikandel 310            # prijs wijzigen
sudo docker exec bakkumbruist node snack.js uit kaassouffle                # tijdelijk van de kaart
sudo docker exec bakkumbruist node snack.js aan kaassouffle                # weer erop
sudo docker exec bakkumbruist node snack.js naam friet "Patat"             # hernoemen
sudo docker exec bakkumbruist node snack.js eenheid friet persoon          # per stuk <-> per persoon
sudo docker exec bakkumbruist node snack.js volgorde kipcorn 40            # positie in de lijst
```

**Startassortiment:** friet € 2,90 **per persoon**, frikandel € 2,90, kroket € 3,00, kaassoufflé € 3,00 (die drie per stuk).

**Prijzen altijd in centen** (`275` = € 2,75). Het script waarschuwt als een bedrag boven € 50 uitkomt — meestal betekent dat euro's in plaats van centen. Een snack **uitzetten verwijdert niets**: bestaande bestellingen en hun bedragen blijven staan, de snack verdwijnt alleen uit het formulier.

Met `--per persoon` (of `snack.js eenheid <slug> persoon`) telt een regel porties in plaats van stuks. Dat verandert alleen de vraagstelling en de weergave — het rekenwerk blijft aantal × prijs. Een bestaande bestelling houdt zijn aantal; alleen het woord eromheen verandert.

## Data bekijken, back-uppen, terugzetten

De database draait in **WAL-modus**. Het `.db`-bestand alleen kopiëren is daarom níét genoeg — dan mis je alles wat nog in `bakkumbruist.db-wal` staat. Gebruik altijd `backup-db.js`, dat een `VACUUM INTO` doet: één consistent bestand, zonder de site stil te leggen.

```bash
# Back-up maken
sudo docker exec bakkumbruist node /app/backup-db.js /tmp/bb.db
sudo docker exec bakkumbruist cat /tmp/bb.db > ~/bakkumbruist-$(date +%F).db
sudo docker exec bakkumbruist rm -f /tmp/bb.db

# Snel iets opzoeken
sudo docker exec bakkumbruist node -e "
  const db=require('/app/db').open();
  console.log(db.prepare('SELECT huisnummer, komt, naam FROM aanmelding ORDER BY huisnummer').all());"

# Terugzetten (site gaat even uit de lucht)
cd /opt/static-sites && sudo docker compose stop bakkumbruist
sudo cp ~/bakkumbruist-2026-09-01.db /var/lib/docker/volumes/static-sites_bakkumbruist-data/_data/bakkumbruist.db
sudo rm -f /var/lib/docker/volumes/static-sites_bakkumbruist-data/_data/bakkumbruist.db-wal \
           /var/lib/docker/volumes/static-sites_bakkumbruist-data/_data/bakkumbruist.db-shm
sudo docker compose start bakkumbruist
```

> Bij terugzetten moeten `-wal` en `-shm` weg, anders plakt SQLite de oude journal op de teruggezette database.

Het TROGDOR-backupscript (`/usr/local/sbin/trogdor-backup.sh`, dagelijks 03:00) doet precies dit en zet het resultaat als `content/bakkumbruist.db` in de dagelijkse backup (GFS-retentie, daarna naar de NAS).

**Het oude `aanmeldingen.json` is sinds 27-08-2026 een bevroren archief.** De database is de enige bron van waarheid; er wordt niet meer naar de JSON geschreven. Het bestand blijft staan (en gaat mee in de backup als `bakkumbruist-aanmeldingen-archief.json`) voor het geval we ooit iets willen naslaan.

## Migratie van de JSON

`migreer-json.js` heeft de 32 bestaande reacties omgezet. Alle bestaande aantallen zijn `deelname = 'dag'` geworden — die mensen hadden zich voor de hele dag opgegeven, het avondtarief bestond nog niet.

Het script is **idempotent** en controleert zichzelf: het telt aanmeldingen, "komt = ja"-huizen en het totaal aantal personen uit zowel de JSON als de database en vergelijkt die binnen dezelfde transactie. Wijkt er iets af, dan wordt teruggedraaid en verandert er niets. De migratie wordt gemarkeerd in de `meta`-tabel; een tweede run doet niets en rapporteert alleen. `server.js` roept hem bij het opstarten aan, zodat een verse container zichzelf vult.

Uitkomst van de echte migratie (27-08-2026):

```
32 aanmelding(en) ingevoegd.
JSON       aanmeldingen=32  komt=ja: 19  personen: 69  (t/m 8: 18, 9–13: 12, 14–18: 2, volwassen: 37)
database   aanmeldingen=32  komt=ja: 19  personen: 69  (t/m 8: 18, 9–13: 12, 14–18: 2, volwassen: 37)
```

Handmatig draaien (rapporteert alleen als er al gemigreerd is):

```bash
sudo docker exec bakkumbruist node /app/migreer-json.js
```

## Organisatiepagina

`/aanmeldingen` (noindex, beveiligd) toont:

- **Todo-tracker**: vier statussen die altijd optellen tot 53 — aangemeld / misschien / afgemeld / onbekend, met gestapelde voortgangsbalk.
- **Totalen**: personen overdag en 's avonds, uitgesplitst per leeftijdsgroep, plus de totale bijdrage en het totale eetbedrag.
- **Bestellijst voor De Toren**: één compact blok met per snack het totaal en het bedrag, geschreven zoals je het doorbelt (*"12 personen friet"*, *"23× Kroket"*), met een knop om het als platte tekst te kopiëren. Dit is wat er letterlijk doorgebeld wordt en staat daarom bewust los van de rest. **Er staat geen totaalaantal onder:** porties per persoon en losse snacks bij elkaar optellen levert een getal zonder betekenis, dus alleen het bedrag telt op.
- **Bestellingen per huis**: de basis voor de tikkies. Kolommen komen uit de snacktabel.
- **Alle reacties**: per huis de dag- en avondaantallen per leeftijdsgroep, en **bijdrage, eten en totaal alle drie zichtbaar**.
- **Wie ontbreekt**: huizen zonder aanmelding (met één klik te markeren als *afgemeld* of *misschien*) en aangemelde dag-huizen zonder bestelling.
- **CSV-export** van zowel de aanmeldingen als de bestellingen.

Een huis dat besteld heeft en daarna zijn aanmelding wijzigt naar "komt niet" of "alleen avond" wordt **niet stilzwijgend meegeteld** voor De Toren, maar apart gemeld onder de bestellijst — even navragen dus.

**Auth:** HTTP Basic Auth op alle organisatie-routes, inclusief de data-endpoints. Het wachtwoord komt uit `AANMELDINGEN_WACHTWOORD` in `/opt/static-sites/.env` (chmod 600), **niet** uit deze repo. Wijzigen:

```bash
sudo sed -i 's/^AANMELDINGEN_WACHTWOORD=.*/AANMELDINGEN_WACHTWOORD=NIEUW/' /opt/static-sites/.env
cd /opt/static-sites && sudo docker compose up -d bakkumbruist
```

**IP-whitelist (geen wachtwoord nodig):** komma-gescheiden, los IP of CIDR-range, IPv4 én IPv6 door elkaar, in `AANMELDINGEN_IP_WHITELIST` in `/opt/static-sites/.env`:

```bash
# voorbeeld (documentatie-ranges; de echte staan in .env, niet in deze repo)
AANMELDINGEN_IP_WHITELIST=203.0.113.5,2001:db8::/48
cd /opt/static-sites && sudo docker compose up -d bakkumbruist   # geen --build nodig
```

De server leest het echte client-IP uit de `X-Real-IP`-header die NPM zet (gelijk aan `$remote_addr`, dus niet door de bezoeker te spoofen).

## Instellingen (omgeving)

Allemaal in `/opt/static-sites/.env`, doorgegeven via `docker-compose.yml`. Wijzigen = `.env` editen + `docker compose up -d bakkumbruist` (géén `--build`).

| Variabele | Betekenis |
|-----------|-----------|
| `AANMELDINGEN_WACHTWOORD` | Wachtwoord voor de organisatiepagina |
| `AANMELDINGEN_IP_WHITELIST` | IP's/ranges die zonder wachtwoord mogen |
| `BESTEL_DEADLINE` | Het moment zelf, ISO **met expliciete offset** (`2026-09-08T23:59:00+02:00`) — geen twijfel over zomertijd |
| `BESTEL_DEADLINE_TEKST` | Hoe de deadline op de site staat, in gewone taal |
| `CONTACT_EMAIL` | Adres in foutmeldingen en na de deadline |
| `TARIEF_DAG_CENT` / `TARIEF_AVOND_CENT` | Bijdrage per persoon in centen |

## Secties (in volgorde)

1. **Hero** *(wit)* — logo, "De datum is geprikt"-badge, twee hoofdknoppen (`Meld je aan` in zeeblauw, `Bestel je eten` in zonnegeel) met daaronder de besteldeadline uit `/api/instellingen`, en een rustiger tweede rij met WhatsApp
2. **Wat is Bakkum Bruist?** *(duinzand)*
3. **De datum staat vast** *(wit)* — datum-badge 12 sep + uitleg waarom
4. **Waar we aan werken** *(duinzand)* — activiteitenlijst
5. **Meld je aan** *(wit)* — uitleg dat opnieuw invullen met hetzelfde huisnummer je opgave bijwerkt, openbare teller, aanmeldformulier (dag + inklapbaar avondblok + live bijdrage) + link naar `/eten`
6. **Doe mee** *(duinzand)* — comité + WhatsApp + mailcontact

`/eten` is een aparte pagina in dezelfde huisstijl, met een link terug naar de hoofdpagina.

## Lokaal draaien

```bash
cd /var/www/bakkumbruist && npm run dev    # http://localhost:8000, data in ./.data
```

(De server leest `PORT`, `STATIC_DIR` en `DATA_DIR` uit de omgeving; in de container zijn dat 80, `/static` en `/data`.)

## Deploy-workflow

```bash
# 1. Edit live in /var/www/bakkumbruist/
# 2. Bij wijziging van server.js / db.js / Dockerfile: container herbouwen
cd /opt/static-sites && sudo docker compose up -d --build bakkumbruist
#    (puur HTML/CSS/JS wijzigen werkt direct — /static is een live read-only mount)
# 3. Kopieer naar de repo en push (alles in het Nederlands)
cp -r /var/www/bakkumbruist/* /home/randal/bakkumbruist-repo/
cd /home/randal/bakkumbruist-repo && git add <bestanden> && git commit && git push
```

De daily update-cron (`trogdor-pull-updates.sh`) bouwt deze container automatisch mee.

## Status

- ✅ Datum geprikt: zaterdag 12 september 2026
- ✅ Aanmeldformulier live (per huishouden, upsert, komt/komt-niet, leeftijdsgroepen)
- ✅ **Opslag in SQLite** (was JSON), met gecontroleerde migratie van de 32 bestaande reacties
- ✅ **Dag- en avonddeelname** met eigen tarief en live berekening van de bijdrage
- ✅ **Bestelformulier voor het eten** op `/eten`, gekoppeld aan de aanmelding, assortiment volledig data-gedreven
- ✅ Openbare teller (alleen unieke "komt = ja"-adressen)
- ✅ Beveiligd dashboard `/aanmeldingen`: tracker, totalen, bestellijst voor De Toren, bestellingen per huis, CSV-exports
- ✅ IP-whitelist: dashboard zonder wachtwoord vanaf vertrouwde IP's
- ⏳ Tikkies volgen later, apart voor de bijdrage en voor het eten
