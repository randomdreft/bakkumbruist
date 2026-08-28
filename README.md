# Bakkum Bruist 2026 — Eikenhorst

Single-page site voor het buurtfeest op de Eikenhorst in Bakkum (gemeente Castricum), met een officieel aanmeldformulier, een bestelformulier voor het eten en een beveiligde overzichtspagina voor de organisatie.

**Live:** [bakkumbruist.nl](https://bakkumbruist.nl) · **Datum:** zaterdag 12 september 2026

## Tech

Plain HTML/CSS/JS aan de voorkant (geen framework, geen bundler, geen externe fonts of trackers) + een kleine **zero-dependency Node-server** (`server.js`) die zowel de statische bestanden serveert als de aanmeldingen en bestellingen verwerkt. Opslag is **SQLite** via de ingebouwde `node:sqlite` van Node 22 — dus nog steeds geen npm-install en geen native build in de daily pipeline.

## Structuur

```
.
├── index.html         single page (hero, praktische oproep, programma, aanmeldformulier + teller, uitleg, doe mee)
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
├── package.json       dev- en testscripts voor lokaal draaien
├── test/              regressietests (draaien met `npm test`, zonder dependencies)
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
| `bestelling` | één rij per huis: `aanmelding_id` (FK, UNIQUE), tijdstempels. (De kolom `opmerking` staat nog in het schema maar wordt nergens meer gelezen of geschreven — zie hieronder.) |
| `bestelregel` | `bestelling_id` (FK, CASCADE), `snack_id` (FK), `aantal`, `prijs_cent_bij_bestelling`. UNIQUE op (bestelling, snack) |
| `meta` | sleutel/waarde, o.a. de markering dat de JSON-migratie gedaan is |

Drie keuzes die uitleg verdienen:

- **`deelnemer` is een aparte tabel, geen acht kolommen in `aanmelding`.** Een leeftijdsgroep of een tariefsoort erbij is dan een rij, geen schemawijziging.
- **`prijs_cent_bij_bestelling` is opzettelijk gedenormaliseerd.** Wijzigt De Toren de prijs nadat mensen besteld hebben, dan blijven de al verstuurde bevestigingen kloppen. Nieuwe bestellingen pakken vanzelf de nieuwe prijs.
- **`eenheid` staat in de data, niet in de teksten.** Er zijn er drie: `stuk` (losse snacks), `persoon` (friet — één portie per persoon) en `bakje` (een verpakking met meerdere stuks, zoals de kipnuggets per zes). De eenheid bepaalt de prijsregel (*"per stuk"* / *"per persoon"* / *"per bakje"*), de vraagstelling op het formulier, de kolomkop op het dashboard, het achtervoegsel in de CSV (`_stuks`, `_personen`, `_bakjes`) en hoe een regel gelezen wordt: alleen losse stuks krijgen een ×, al het andere noemt zijn eenheid — *"4 personen friet"*, *"2 bakjes kipnuggets (6 stuks)"*, *"3× Kroket"*. Ook in de lijst die naar De Toren gaat. Een volgende snack in zo'n eenheid is dus één vlaggetje en geen tekstwijziging.

- **Hoeveel er in een bakje zit, hoort in de `naam`.** De eenheid zegt *dat* het per bakje gaat, niet *hoeveel* erin zit. Alleen `naam` bereikt óók de kolomkoppen, de CSV en de lijst die je doorbelt — vandaar `Kipnuggets (6 stuks)` en niet `Kipnuggets` met het aantal ergens anders.

- **`omschrijving` is het regeltje onder de naam op het formulier.** Daar hoort in wat er over dít product te weten valt: dat een bakje zes nuggets is, of dat een burger niet aan te passen is. Zo verhuist die informatie mee als het assortiment verandert, in plaats van in de paginatekst achter te blijven.

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

**Privacy.** Er is geen login voor bewoners; identificatie op huisnummer is genoeg voor een straatfeest. `/api/bestelstatus` geeft daarom bewust alleen terug wat dit huis over zichzelf mag weten — **nooit** namen of contactgegevens, van welk huis dan ook:

| Veld | Wat |
|------|-----|
| `mag`, `readonly`, `reden`, `bericht` | mag dit huis bestellen, en zo niet: waarom, in gewone taal |
| `bestelling` | de eigen regels en het totaal (`null` als er nog niets is) |
| `dag_personen` | het eigen aantal dagdeelnemers — alleen als het huis mag bestellen, als geheugensteun bij *"voor hoeveel personen friet?"* |
| `deadline_tekst`, `deadline_verstreken`, `contact_email` | dezelfde publieke waarden als `/api/instellingen` |

## Toegangsregels voor het bestellen

Allemaal server-side afgedwongen, in deze volgorde:

1. Huisnummer niet in de lijst van 53 adressen → *"Dit nummer kennen we niet op de Eikenhorst"*
2. Geen aanmelding → eerst aanmelden, met een link naar het formulier
3. `komt = misschien` → eerst officieel aanmelden
4. `komt = nee` → *"Volgens onze administratie komen jullie dit jaar niet"*
5. Wel aangemeld maar **nul dagdeelnemers** → geen formulier; het eten wordt om half zes uitgedeeld en het avondprogramma begint pas om half acht
6. Deadline verstreken → readonly, met de al geplaatste bestelling zichtbaar

Verder valideert de server:

- aantallen als gehele getallen 0–20 (daarbuiten wordt bijgeknipt, niet geweigerd);
- snack-id's alleen tegen **actieve** snacks — een onbekend of uitgezet id valt stil weg;
- de prijs komt altijd uit de database, nooit uit wat de client meestuurt;
- **een bestelling moet minstens één snack bevatten.** Een inzending zonder regels leverde vroeger een bestelling van € 0,00 op die wél in de lijst voor De Toren belandde. Zowel de server (HTTP 400 `lege_bestelling`) als het formulier weigeren dat, en `test/lege-bestelling.test.js` bewaakt allebei. Een lege inzending wist ook een bestaande bestelling niet.

## Het assortiment is zoals het is

Er zit **geen opmerkingveld** meer op het bestelformulier, en de server negeert een `opmerking` in de body van `POST /api/bestelling`. Aanleiding: De Toren rijdt 53 huishoudens in één keer aan en kan geen individuele wensen uitvoeren, maar een invulveld suggereert van wel — en wat erin stond kwam ongelezen op de lijst terecht. Wat er nu voor in de plaats staat:

- onder het formulier één regel dat alles komt zoals De Toren het maakt, met het mailadres uit `CONTACT_EMAIL` voor wie tóch iets belangrijks te melden heeft (een allergie bijvoorbeeld);
- bij de burgers een `omschrijving` die het per product herhaalt: *"Zoals De Toren hem maakt — aanpassen of weglaten kan niet."*

**De kolom `bestelling.opmerking` is leeg en wordt nergens meer gebruikt.** Er stond één regel in — die bleek testinvoer en is op 28-08-2026 gewist (back-up ervóór: `~/bakkumbruist-backups/bakkumbruist-2026-08-28-voor-wissen-opmerkingen.db`). Daarna is de kolom ook uit het dashboard en uit de bestellingen-CSV gehaald: een kolom die voor alle 53 huizen altijd leeg blijft, is alleen maar ruis. De kolom zelf staat nog in het schema (`NOT NULL DEFAULT ''`) maar wordt niet gelezen en niet geschreven; hem droppen zou een tabelmigratie kosten en levert niets op.

> **Let op bij het doorbellen:** allergieën en andere wensen komen niet meer via het formulier binnen, alleen nog per mail. Noteer die zelf en neem ze mee als je belt — ze staan nergens automatisch in de lijst.

Simpele rate-limiting per IP, in vensters van 10 minuten: 30 aanmeldingen, 30 bestellingen, 120 keer bestelstatus opvragen. Daarboven volgt HTTP 429.

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
sudo docker exec bakkumbruist node snack.js omschrijving hamburger "Zoals hij is."   # regeltje eronder
sudo docker exec bakkumbruist node snack.js omschrijving hamburger ""      # regeltje weer weg
sudo docker exec bakkumbruist node snack.js eenheid friet persoon          # stuk | persoon | bakje
sudo docker exec bakkumbruist node snack.js volgorde kipcorn 40            # positie in de lijst
```

**Startassortiment** (`SNACK_SEED` in `db.js`, vult alleen wat er nog niet staat):

| Snack | Prijs | Eenheid |
|-------|-------|---------|
| Friet | € 2,90 | **per persoon** — één portie per persoon |
| Frikandel | € 2,90 | per stuk |
| Kroket | € 3,00 | per stuk |
| Kaassoufflé | € 3,00 | per stuk |
| Kipnuggets (6 stuks) | € 4,75 | **per bakje** — één bakje = 6 nuggets |
| Hamburger | € 6,75 | per stuk — geen maatwerk |
| Vegaburger | € 8,25 | per stuk — geen maatwerk |

**Prijzen altijd in centen** (`275` = € 2,75). Het script waarschuwt als een bedrag boven € 50 uitkomt — meestal betekent dat euro's in plaats van centen. Een snack **uitzetten verwijdert niets**: bestaande bestellingen en hun bedragen blijven staan, de snack verdwijnt alleen uit het formulier.

Met `--per persoon` of `--per bakje` (of achteraf `snack.js eenheid <slug> persoon|bakje`) telt een regel porties of verpakkingen in plaats van losse stuks. Dat verandert alleen de vraagstelling en de weergave — het rekenwerk blijft aantal × prijs. Een bestaande bestelling houdt zijn aantal; alleen het woord eromheen verandert.

**Een eenheid erbij** is één regel in `EENHEDEN` (`db.js`) plus die waarde toestaan in de `CHECK` op `snack.eenheid` en in `eenheidUit()` van `snack.js`. Alle plekken die de eenheid gebruiken — formulier, kolomkoppen, CSV-achtervoegsel, de lijst voor De Toren — lezen de woorden uit die tabel en hoeven niets te weten van de nieuwe waarde.

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

## Runbook: wat doe je wanneer

Voor de organisatie, in volgorde van de kalender. Alles begint op
`bakkumbruist.nl/aanmeldingen`.

**Doorlopend, tot de besteldeadline**

- Kijk bij *Nog te benaderen* wie nog niets liet horen. Hoorde je iemand
  persoonlijk? Markeer het adres met één klik als *afgemeld* of *misschien* —
  dat schuift het uit de todo-lijst zonder dat je iets verzint over aantallen.
  Meldt datzelfde huis zich later alsnog via het formulier, dan wint dat: een
  formulier-inzending overschrijft je markering.
- Onder *Komen overdag, maar bestelden nog niets* staat wie je eventueel nog
  een duwtje geeft over het eten.

**Op de besteldeadline (`BESTEL_DEADLINE`)**

1. Open `/aanmeldingen` en klik **Kopieer lijst** in het blok *Bestellijst voor
   De Toren*. Dat is precies wat je doorbelt, meer niet.
2. Kijk of er onder dat blok een regel *"Niet meegeteld"* staat. Dan heeft een
   huis besteld en daarna zijn aanmelding gewijzigd naar "komt niet" of "alleen
   avond". Even bellen voordat je doorgeeft — die bestelling zit **niet** in de
   lijst.
3. Bel De Toren. Vanaf dat moment is het formulier voor iedereen readonly; de
   server sluit dat zelf af, daar hoef je niets voor te doen.

**Voor de tikkies**

Twee losse bedragen, nooit optellen tot één zonder beide te noemen:

- de **bijdrage** aan het feest (€ 17,50 per dagdeelnemer, € 7,50 per
  avondgast) — kolom *Bijdrage* in *Alle reacties*;
- het **eten**, dat één op één naar De Toren gaat — kolom *Eten*.

De kolom *Totaal* staat er alleen als handvat. Download desnoods beide CSV's
voor de administratie.

**Als iemand belt dat er iets niet klopt**

- *"Ik wil mijn aanmelding wijzigen"* → laat ze het formulier gewoon opnieuw
  invullen met hetzelfde huisnummer. Dat overschrijft de vorige opgave en laat
  hun eetbestelling staan.
- *"Ik kan niet bestellen"* → de pagina zegt zelf waarom. Meestal: nog niet
  aangemeld, of alleen 's avonds opgegeven.
- *"Ik heb een allergie"* of *"kan de burger zonder ui?"* → het assortiment is
  zoals het is; De Toren maakt niets op maat. Er is daarom geen opmerkingveld
  meer. Komt er tóch iets belangrijks binnen per mail, noteer dat dan zelf en
  neem het mee als je belt — het staat nergens automatisch in de lijst.
- *"Moet ik saus of een broodje bestellen?"* → nee, allebei niet. Die staan er
  gewoon: mayonaise, curry en ketchup, en broodjes om je snack op te doen. Dat
  staat ook boven aan het bestelformulier.
- *"Ik heb per ongeluk verkeerd besteld"* → opnieuw insturen vervangt de hele
  bestelling. Na de deadline kan dat niet meer; dan pas je het met de hand aan
  in de database, of je regelt het rechtstreeks met De Toren.

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

1. **Hero** *(wit)* — logo, datum, starttijd, twee hoofdknoppen (`Meld je aan` in zeeblauw, `Bestel je eten` in zonnegeel) met daaronder de besteldeadline uit `/api/instellingen`, en een rustiger tweede rij met WhatsApp
2. **Wat we nog zoeken** *(duinzand)* — praktische oproep voor partytenten, statafels, stroommateriaal en helpers
3. **Het programma** *(wit)* — verticale tijdlijn met de actuele tijden van opbouw tot muziek uit
4. **Meld je aan** *(wit)* — uitleg dat opnieuw invullen met hetzelfde huisnummer je opgave overschrijft, openbare teller, aanmeldformulier (dag + inklapbaar avondblok + live bijdrage) + link naar `/eten`
5. **Wat is Bakkum Bruist?** *(wit)* — korte achtergrond, bewust pas na de praktische informatie
6. **Doe mee** *(duinzand)* — comité + WhatsApp + mailcontact

`/eten` is een aparte pagina in dezelfde huisstijl, met een link terug naar de hoofdpagina. Bovenaan staat wat je *niet* hoeft te bestellen omdat het er gewoon is (saus en broodjes). Het formulier bouwt zichzelf uit de snacktabel; onderaan staat één regel dat alles komt zoals De Toren het maakt, met het mailadres uit `CONTACT_EMAIL` erin (door `eten.js` ingevuld, niet in de HTML gehardcodeerd).

## Lokaal draaien

```bash
cd /var/www/bakkumbruist && npm run dev    # http://localhost:8000, data in ./.data
npm test                                   # regressietests
```

(De server leest `PORT`, `STATIC_DIR` en `DATA_DIR` uit de omgeving; in de container zijn dat 80, `/static` en `/data`.)

`npm test` start de server op een eigen poort met een eigen database in een
tijdelijke map en praat er via HTTP mee — het raakt de live data niet aan en
heeft geen dependencies of netwerk nodig. Wat er nu bewaakt wordt:

| Test | Bewaakt |
|------|---------|
| `test/lege-bestelling.test.js` | een bestelling zonder snacks wordt geweigerd, server- én client-side, en wist een bestaande bestelling niet |
| `test/assortiment.test.js` | geen opmerkingveld meer in `eten.html`/`eten.js`, de server neemt er geen aan, de burgers dragen hun eigen "geen maatwerk"-regel, en de kipnuggets zeggen in naam én eenheid dat het per bakje van zes gaat |

(`test/helpers.js` bevat de gedeelde opstart: server op een vrije poort, verse database in een tijdelijke map.)

Draai hem na elke wijziging aan `server.js` of `eten.js`, en vóór het pushen.

## Deploy-workflow

```bash
# 1. Edit live in /var/www/bakkumbruist/
#    HTML wijzigen werkt direct — /static is een live read-only mount.
# 2. CSS of frontend-JS gewijzigd? Bump de ?v= (zie hieronder), anders blijft
#    het bij bezoekers met een gecachte kopie hangen.
# 3. Bij wijziging van server.js / db.js / Dockerfile: container herbouwen
cd /opt/static-sites && sudo docker compose up -d --build bakkumbruist
# 4. Testen
cd /var/www/bakkumbruist && npm test
# 5. Kopieer naar de repo en push (alles in het Nederlands)
cp -r /var/www/bakkumbruist/* /home/randal/bakkumbruist-repo/
cd /home/randal/bakkumbruist-repo && git add <bestanden> && git commit && git push
```

De daily update-cron (`trogdor-pull-updates.sh`) bouwt deze container automatisch mee.

### Cache-busting: bump de `?v=` bij CSS- en JS-wijzigingen

De pagina's linken naar `styles.css?v=…` en `script.js?v=…`. De server zet op
alles behalve HTML een `Cache-Control: public, max-age=3600`, dus zonder een
nieuwe `?v=` ziet een bezoeker die de site al eens opende tot een uur lang de
oude stylesheet — met een half kapotte pagina als de HTML wél veranderde.
HTML zelf staat op `no-cache` en ververst altijd.

**`styles.css` staat in drie bestanden**, dus alle drie bumpen. Even nalopen wat
er nu staat:

```bash
cd /var/www/bakkumbruist
grep -n -E 'styles\.css\?v=|script\.js\?v=|eten\.js\?v=' index.html eten.html aanmeldingen.html
```

Alle drie tegelijk bijwerken naar de datum van vandaag (plakletter erachter als
je op één dag meerdere keren wijzigt — `20260828`, `20260828b`, …):

```bash
sudo sed -i 's/styles\.css?v=[0-9a-z]*/styles.css?v=20260828/' index.html eten.html aanmeldingen.html
```

De versies van `script.js` en `eten.js` staan los van die van de CSS en hoeven
alleen mee als dat bestand zelf verandert. De waarde zelf is betekenisloos —
het moet alleen iets *anders* zijn dan de vorige keer.

### Wat er publiek geserveerd wordt

`/var/www/bakkumbruist` is tegelijk de build-context én de webroot. Alles wat
er ligt is dus opvraagbaar: `bakkumbruist.nl/server.js`, `/db.js`,
`/package.json`, `/README.md` — allemaal HTTP 200. Dat is geen lek: de repo is
publiek op GitHub en de code bevat geen geheimen (wachtwoord, IP-whitelist en
deadline komen uit `.env`, die niet in deze map staat). Maar het betekent wél:

- **zet nooit een bestand met geheimen in deze map** — ook niet tijdelijk;
- bewaar backups en kopietjes buiten de map, in `~/bakkumbruist-backups/`. De
  server weigert namen als `.bak` en `.pre-` (zie boven), maar reken daar niet
  op als enige verdediging.

Wil je de servercode helemaal niet meer serveren, dan is dat één regel extra in
`VERBODEN_BESTAND` in `serveStatic()`. Bewust nog niet gedaan: het levert geen
beveiliging op zolang dezelfde bestanden publiek op GitHub staan.

## Status

- ✅ Datum geprikt: zaterdag 12 september 2026
- ✅ Aanmeldformulier live (per huishouden, upsert, komt/komt-niet, leeftijdsgroepen)
- ✅ **Opslag in SQLite** (was JSON), met gecontroleerde migratie van de 32 bestaande reacties
- ✅ **Dag- en avonddeelname** met eigen tarief en live berekening van de bijdrage
- ✅ **Bestelformulier voor het eten** op `/eten`, gekoppeld aan de aanmelding, assortiment volledig data-gedreven
- ✅ Openbare teller (alleen unieke "komt = ja"-adressen)
- ✅ Beveiligd dashboard `/aanmeldingen`: tracker, totalen, bestellijst voor De Toren, bestellingen per huis, CSV-exports
- ✅ IP-whitelist: dashboard zonder wachtwoord vanaf vertrouwde IP's
- ✅ **Geen maatwerk meer** (28-08-2026): opmerkingveld weg (kolom leeg en uit dashboard + CSV), burgers en kipnuggets toegevoegd, eenheid `bakje` erbij
- ⏳ Tikkies volgen later, apart voor de bijdrage en voor het eten
