# Bakkum Bruist 2026

Statische landingspagina voor het buurtfeest op de Eikenhorst in Bakkum.

Live: [bakkumbruist.nl](https://bakkumbruist.nl)

## Lokaal bekijken

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Structuur

- `index.html` — single-page met alle secties (hero, idee, planning, datum, comité, doe mee)
- `styles.css` — huisstijl (zeeblauw/diepblauw/zonnegeel/koraal/duinzand), mobile-first, max 720px contentbreedte
- `script.js` — dynamisch jaartal in de footer
- `favicon.png` — afgeleid van logo-badge
- `huisstijl/` — alle logo-varianten (badge, horizontaal, mono — PNG en SVG)

## Tech

Plain HTML/CSS/JS — geen build-step, geen framework, geen externe fonts of trackers. Trebuchet MS met Verdana fallback. Open Graph-tags voor WhatsApp/iMessage previews.

## Hosting

Live op TROGDOR via de `bakkumbruist` nginx-container in `/opt/static-sites/`. Bronmap: `/var/www/bakkumbruist/`. Bij elke wijziging: edit live, kopieer naar deze repo, `git commit && git push`.

## TODO voor volledige launch

- WhatsApp-uitnodigingslink invullen (zoek `<<WHATSAPP_INVITE_LINK>>` in `index.html`)
