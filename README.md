# Bakkum Bruist 2026 — Eikenhorst

Statische single-page voor het buurtfeest op de Eikenhorst in Bakkum (gemeente Castricum). Inclusief richtinggevende datum-poll die stemmen naar een Google Sheet schrijft.

**Live:** [bakkumbruist.nl](https://bakkumbruist.nl)

## Tech

Plain HTML/CSS/JS — geen build-step, geen framework, geen bundler, geen externe fonts of trackers. Vanille-JS doet een `fetch` naar een Google Apps Script-webhook voor de poll. Trebuchet MS met Verdana fallback. Open Graph-tags voor WhatsApp/iMessage previews.

## Structuur

```
.
├── index.html         single page, alle secties
├── styles.css         huisstijl + alternerende secties + poll-styling
├── script.js          dynamisch jaartal + poll-formulier-logica
├── apps-script.gs     Google Apps Script (webhook achter de poll)
├── POLL_SETUP.md      Stap-voor-stap setup van de Google Sheet-backend
├── favicon.png        afgeleid van logo-badge
└── huisstijl/         logo-varianten (badge, horizontaal, mono — PNG en SVG)
```

## Secties (in volgorde)

1. **Hero** — logo, "Stemming loopt — denk mee" badge, primaire CTA `Denk mee over de datum` + secundaire WhatsApp-knop
2. **Wat is Bakkum Bruist?** *(duinzand)* — context over het buurtinitiatief
3. **Stem mee op de datum** — vier-velden formulier (datum, huisnummer, optioneel email, submit) met dubbele-stem-detectie + wijzigingsflow
4. **Wat staat er op de planning** *(duinzand)* — wat vaststaat
5. **Wanneer?** — recap van de twee kandidaat-datums, link terug naar de poll
6. **Doe mee** *(duinzand)* — comité-namen inline + WhatsApp-CTA + mailcontact

Wit/duinzand alternatie geeft visueel ritme. Geaccentueerde secties hebben `class="section-accent"`, wat een full-width duinzand-bleed-effect oplevert via `box-shadow` + `clip-path`.

## Huisstijl

| Kleur | Hex | Gebruik |
|-------|-----|---------|
| Zeeblauw | `#1A91A8` | Primaire knoppen, links, h1, sectie-iconen |
| Diepblauw | `#0F4C5C` | Body-tekst, h2/h3, secundaire knop-borders |
| Zonnegeel | `#FFC93C` | Focus-states, scroll-hint underline |
| Koraal | `#FF6B6B` | Badge, foutmeldingen, bullets, `con`-bullet in cards |
| Duinzand | `#F4E9D8` | Achtergrond van geaccentueerde secties + datum-cards |
| Wit | `#FFFFFF` | Achtergrond van neutrale secties |

Sectie-iconen zijn Feather-style inline SVG (24x24, stroke 2, currentColor in zeeblauw).

## Datum-poll

Bewoners van de Eikenhorst kunnen stemmen op een van twee zaterdagen in september 2026. Geldige huisnummers: oneven 1–77 en even 2–28. Per huisnummer max één stem; bij dubbele inzending krijgt de gebruiker de keuze om de bestaande stem te overschrijven.

**Backend:** Google Apps Script als webhook → Google Sheet `Bakkum Bruist 2026 — datum-poll`, kolommen: `timestamp | voorkeursdatum | huisnummer | email | user_agent`.

**Setup:** zie [`POLL_SETUP.md`](./POLL_SETUP.md).

**Bij wijziging van datum-opties:** update de array in `apps-script.gs` (`isValidDatum()`), de `DATUM_LABELS`-map in `script.js`, en de drie hardcoded HTML-blokken in `index.html` (`<label class="poll-option">` × N).

## Lokaal werken

```bash
cd /var/www/bakkumbruist && python3 -m http.server 8000
# open http://localhost:8000
```

Voor het mocken van de poll-fetch zonder Google Sheet, zie de instructies in [`POLL_SETUP.md`](./POLL_SETUP.md#lokaal-testen-zonder-echte-sheet).

## Hosting

Live op TROGDOR via de `bakkumbruist` nginx-container in de `static-sites`-stack (`/opt/static-sites/docker-compose.yml`). Bronmap: `/var/www/bakkumbruist/`. Bij elke wijziging:

1. Edit live in `/var/www/bakkumbruist/`
2. Kopieer gewijzigde bestanden naar `/home/randal/bakkumbruist-repo/`
3. `git add`, `git commit`, `git push` — alles in het Nederlands, ook commit messages

## Status

- ✅ Site live
- ✅ Datum-poll werkt (2 opties, dubbele-stem-check, wijzigingsflow)
- ✅ Google Sheet-backend deployed
- ⏳ **Datum nog niet geprikt** — poll loopt, comité kiest op basis van uitkomst
- ⏳ **Aftelteller** "Nog X dagen tot het feest" — wachten op definitieve datum
- ⏳ **Save-the-date-mode** — wanneer datum vaststaat: poll-sectie vervangen door een prominent "Zaterdag X september 2026"-blok
