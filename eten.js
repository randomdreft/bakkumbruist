(function () {
    'use strict';

    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var CONTACT_EMAIL = 'slems_verenigd1q@icloud.com';
    var MAX_AANTAL = 20;

    var huisForm = document.getElementById('huis-form');
    var huisInput = document.getElementById('f-huisnummer');
    var huisError = document.getElementById('huis-error');
    var huisSubmit = document.getElementById('huis-submit');
    var statusBlok = document.getElementById('status-blok');
    var bestelForm = document.getElementById('bestel-form');
    var snackLijst = document.getElementById('snack-lijst');
    var bestelError = document.getElementById('bestel-error');
    var bestelSubmit = document.getElementById('bestel-submit');
    var opmerkingVeld = document.getElementById('f-opmerking');
    var bevestiging = document.getElementById('bevestiging');
    var deadlineTekst = document.getElementById('deadline-tekst');
    var deadlineRegel = document.getElementById('deadline-regel');

    var snacks = [];        // uit /api/snacks — de enige bron van het assortiment
    var huidigHuis = null;
    var dagPersonen = 0;    // eigen dagdeelnemers, als hint bij "voor hoeveel personen?"

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }
    function euro(cent) {
        return '€ ' + (cent / 100).toFixed(2).replace('.', ',');
    }
    // Aantal met het woord dat bij de eenheid hoort: "3 stuks" of
    // "3 personen". De eenheid komt uit de database, niet uit deze code.
    function woorden(snack) {
        return (snack && snack.woorden) || { enkelvoud: 'stuk', meervoud: 'stuks', per: 'per stuk', vraag: 'Hoeveel?' };
    }
    function metEenheid(n, snack) {
        var w = woorden(snack);
        return n + ' ' + (n === 1 ? w.enkelvoud : w.meervoud);
    }
    // Regel zoals je hem zou uitspreken: "3 personen friet" of "2× Kroket".
    function regelTekst(n, snack) {
        return snack && snack.eenheid === 'persoon'
            ? metEenheid(n, snack) + ' ' + snack.naam.toLowerCase()
            : n + '× ' + snack.naam;
    }
    function isValidHuisnummer(n) {
        if (!Number.isInteger(n)) return false;
        if (n < 1) return false;
        if (n % 2 === 1) return n <= 77;   // oneven 1–77
        return n >= 2 && n <= 28;           // even 2–28
    }

    function toonHuisError(tekst) {
        huisError.textContent = tekst;
        huisError.hidden = false;
    }
    function wisHuisError() {
        huisError.textContent = '';
        huisError.hidden = true;
    }

    function toonMelding(html, klasse) {
        statusBlok.innerHTML = '<div class="bestel-melding ' + (klasse || '') + '">' + html + '</div>';
        statusBlok.hidden = false;
    }
    function wisMelding() {
        statusBlok.innerHTML = '';
        statusBlok.hidden = true;
    }

    // ---------- Instellingen + assortiment ophalen ----------
    fetch('/api/instellingen', { headers: { 'Accept': 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
            if (!data) return;
            if (data.contact_email) CONTACT_EMAIL = data.contact_email;
            if (data.bestel_deadline_tekst) deadlineTekst.textContent = data.bestel_deadline_tekst;
            if (data.bestel_deadline_verstreken) {
                deadlineRegel.innerHTML = 'De besteltermijn is gesloten sinds <strong>' +
                    esc(data.bestel_deadline_tekst) + '</strong>. Je kunt hieronder nog wel zien wat er besteld is.';
            }
        })
        .catch(function () { /* niet kritisch */ });

    var snacksGeladen = fetch('/api/snacks', { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
            if (!res.ok) throw new Error('http ' + res.status);
            return res.json();
        })
        .then(function (data) {
            snacks = (data && data.snacks) || [];
            if (data && data.max_aantal) MAX_AANTAL = data.max_aantal;
        });

    // ---------- Het bestelformulier opbouwen uit de snacktabel ----------
    function bouwSnackLijst() {
        if (!snacks.length) {
            snackLijst.innerHTML = '<p class="muted">Er staat op dit moment niets op de kaart. ' +
                'Mail <a href="mailto:' + esc(CONTACT_EMAIL) + '">' + esc(CONTACT_EMAIL) + '</a> als dat niet klopt.</p>';
            return;
        }
        snackLijst.innerHTML = snacks.map(function (s) {
            var id = 'snack-' + s.id;
            var w = woorden(s);
            var perPersoon = s.eenheid === 'persoon';
            // Bij een portie per persoon vragen we het ook zo, en zetten we
            // het aantal dagdeelnemers erbij als geheugensteun.
            var hint = perPersoon
                ? w.vraag + (dagPersonen ? ' Jullie komen met ' + dagPersonen + ' overdag.' : '')
                : '';
            return '<div class="snack-rij">' +
                '<div class="snack-info">' +
                    '<label class="snack-naam" for="' + id + '">' + esc(s.naam) + '</label>' +
                    '<span class="snack-prijs">' + euro(s.prijs_cent) + ' ' + esc(w.per) + '</span>' +
                    (s.omschrijving ? '<span class="snack-omschrijving">' + esc(s.omschrijving) + '</span>' : '') +
                    (hint ? '<span class="snack-omschrijving">' + esc(hint) + '</span>' : '') +
                '</div>' +
                '<span class="snack-regeltotaal" id="regel-' + s.id + '"></span>' +
                '<div class="stepper" data-stepper>' +
                    '<button type="button" class="stepper-btn" data-step="-1" aria-label="Minder ' + esc(perPersoon ? 'personen ' + s.naam : s.naam) + '">−</button>' +
                    '<input type="number" id="' + id + '" name="' + esc(s.slug) + '" min="0" max="' + MAX_AANTAL + '" step="1" value="0" inputmode="numeric" data-snack-id="' + s.id + '">' +
                    '<button type="button" class="stepper-btn" data-step="1" aria-label="Meer ' + esc(perPersoon ? 'personen ' + s.naam : s.naam) + '">+</button>' +
                '</div>' +
            '</div>';
        }).join('');

        // Steppers activeren
        Array.prototype.forEach.call(snackLijst.querySelectorAll('[data-stepper]'), function (stepper) {
            var input = stepper.querySelector('input[type="number"]');
            Array.prototype.forEach.call(stepper.querySelectorAll('.stepper-btn'), function (btn) {
                btn.addEventListener('click', function () {
                    var step = parseInt(btn.getAttribute('data-step'), 10) || 0;
                    var v = parseInt(input.value, 10);
                    if (!Number.isInteger(v)) v = 0;
                    v = Math.max(0, Math.min(MAX_AANTAL, v + step));
                    input.value = v;
                    herbereken();
                });
            });
            input.addEventListener('input', herbereken);
        });
    }

    function huidigeRegels() {
        var uit = [];
        Array.prototype.forEach.call(snackLijst.querySelectorAll('input[data-snack-id]'), function (el) {
            var aantal = parseInt(el.value, 10);
            if (!Number.isInteger(aantal) || aantal < 1) return;
            var id = parseInt(el.getAttribute('data-snack-id'), 10);
            var snack = snacks.filter(function (s) { return s.id === id; })[0];
            if (snack) uit.push({ snack: snack, aantal: Math.min(aantal, MAX_AANTAL) });
        });
        return uit;
    }

    // ---------- Live totaal (informatief; de server rekent het definitief na) ----------
    function herbereken() {
        var regels = huidigeRegels();
        var totaalCent = 0, totaalStuks = 0;

        // Regeltotaal naast elke teller
        snacks.forEach(function (s) {
            var cel = document.getElementById('regel-' + s.id);
            if (!cel) return;
            var r = regels.filter(function (x) { return x.snack.id === s.id; })[0];
            cel.textContent = r ? euro(r.aantal * s.prijs_cent) : '';
        });

        document.getElementById('totaal-regels').innerHTML = regels.map(function (r) {
            totaalCent += r.aantal * r.snack.prijs_cent;
            totaalStuks += r.aantal;
            return '<li><span>' + esc(regelTekst(r.aantal, r.snack)) + '</span>' +
                '<span>' + euro(r.aantal * r.snack.prijs_cent) + '</span></li>';
        }).join('');

        var leeg = regels.length === 0;
        document.getElementById('totaal-leeg').hidden = !leeg;
        document.getElementById('totaal-som').hidden = leeg;
        // Bewust geen aantal in de somregel: stuks en personen bij elkaar
        // optellen levert een getal op dat niets betekent.
        document.getElementById('totaal-stuks').textContent = 'Totaal';
        document.getElementById('totaal-bedrag').textContent = euro(totaalCent);
    }

    // ---------- Stap 1: huisnummer opzoeken ----------
    function zoekHuis(huisnummer) {
        huisSubmit.disabled = true;
        huisSubmit.textContent = 'Even kijken…';

        snacksGeladen
            .then(function () {
                return fetch('/api/bestelstatus?huisnummer=' + encodeURIComponent(huisnummer), {
                    headers: { 'Accept': 'application/json' }, cache: 'no-store'
                });
            })
            .then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            })
            .then(function (r) {
                huisSubmit.disabled = false;
                huisSubmit.textContent = 'Verder';
                toonStatus(huisnummer, r.data);
            })
            .catch(function () {
                huisSubmit.disabled = false;
                huisSubmit.textContent = 'Verder';
                toonHuisError('We konden het even niet ophalen. Probeer het zo nog eens, of mail ' + CONTACT_EMAIL + '.');
            });
    }

    var AANMELD_LINK = '<a href="/#aanmelden">Naar het aanmeldformulier &rarr;</a>';

    function toonStatus(huisnummer, data) {
        huidigHuis = huisnummer;
        wisMelding();
        bestelForm.hidden = true;
        bevestiging.hidden = true;

        var huis = '<span class="huisnr">Eikenhorst ' + esc(huisnummer) + '</span>';

        if (!data || data.reden === 'onbekend_huisnummer' || data.error === 'ongeldig_huisnummer') {
            toonHuisError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
            huisInput.setAttribute('aria-invalid', 'true');
            huisInput.focus();
            return;
        }
        huisInput.removeAttribute('aria-invalid');

        if (data.reden === 'geen_aanmelding') {
            toonMelding('<p>' + huis + ': ' + esc(data.bericht) + '</p><p>' + AANMELD_LINK + '</p>', 'waarschuwing');
            return;
        }
        if (data.reden === 'komt_niet' || data.reden === 'nog_niet_zeker') {
            toonMelding('<p>' + huis + ': ' + esc(data.bericht) + '</p><p>' + AANMELD_LINK + '</p>', 'waarschuwing');
            return;
        }
        if (data.reden === 'alleen_avond') {
            toonMelding('<p>' + huis + ': ' + esc(data.bericht) + '</p><p>' + AANMELD_LINK + '</p>', 'waarschuwing');
            return;
        }
        if (data.reden === 'deadline') {
            var html = '<p>' + huis + ': ' + esc(data.bericht) + '</p>';
            html += data.bestelling
                ? overzichtHtml(data.bestelling, 'Dit staat er voor jullie genoteerd')
                : '<p>Er staat geen bestelling voor jullie genoteerd.</p>';
            toonMelding(html, 'gesloten');
            return;
        }

        // Mag bestellen: formulier opbouwen en eventueel voorvullen.
        dagPersonen = data.dag_personen || 0;
        bouwSnackLijst();
        document.getElementById('bestel-kop').textContent = data.bestelling
            ? 'Jullie bestelling voor Eikenhorst ' + huisnummer
            : 'Wat willen jullie hebben, Eikenhorst ' + huisnummer + '?';

        if (data.bestelling) {
            data.bestelling.regels.forEach(function (r) {
                var el = snackLijst.querySelector('input[data-snack-id="' + r.snack_id + '"]');
                if (el) el.value = r.aantal;
            });
            opmerkingVeld.value = data.bestelling.opmerking || '';
            toonMelding('<p>' + huis + ': jullie hebben al besteld. Pas hieronder aan wat je wilt en verstuur opnieuw — ' +
                'we vervangen dan de hele bestelling. Aanpassen kan tot <strong>' + esc(data.deadline_tekst) + '</strong>.</p>');
        }

        bestelForm.hidden = false;
        herbereken();
        bestelForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Overzichtje van een bestelling (bevestiging én readonly na de deadline)
    function overzichtHtml(bestelling, kop) {
        var regels = bestelling.regels.map(function (r) {
            return '<li><span>' + esc(regelTekst(r.aantal, r)) + '</span>' +
                '<span>' + euro(r.regel_cent) + '</span></li>';
        }).join('');
        return '<div class="bestel-bevestiging">' +
            '<h3>' + esc(kop) + '</h3>' +
            '<ul>' + regels +
                '<li class="som"><span>Totaal</span>' +
                '<span>' + euro(bestelling.totaal_cent) + '</span></li>' +
            '</ul>' +
            (bestelling.opmerking ? '<p class="muted small">Jullie opmerking: ' + esc(bestelling.opmerking) + '</p>' : '') +
            '</div>';
    }

    huisForm.addEventListener('submit', function (e) {
        e.preventDefault();
        wisHuisError();
        var ruw = huisInput.value.trim();
        var n = parseInt(ruw, 10);
        if (!ruw || !/^\d+$/.test(ruw) || !isValidHuisnummer(n)) {
            huisInput.setAttribute('aria-invalid', 'true');
            toonHuisError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
            huisInput.focus();
            return;
        }
        zoekHuis(n);
    });

    // ---------- Stap 2: bestelling versturen ----------
    function setLoading(bezig) {
        bestelSubmit.disabled = bezig;
        bestelSubmit.classList.toggle('is-loading', bezig);
        bestelSubmit.querySelector('.form-submit-label').textContent =
            bezig ? 'Versturen…' : 'Bestelling versturen';
    }

    bestelForm.addEventListener('submit', function (e) {
        e.preventDefault();
        bestelError.hidden = true;

        var regels = huidigeRegels();
        var opmerking = opmerkingVeld.value.trim();
        if (!regels.length) {
            bestelError.textContent = 'Er staat nog niets in de bestelling. Zet minstens één snack op 1 of hoger.';
            bestelError.hidden = false;
            return;
        }

        setLoading(true);
        fetch('/api/bestelling', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                huisnummer: huidigHuis,
                opmerking: opmerking,
                regels: regels.map(function (r) { return { snack_id: r.snack.id, aantal: r.aantal }; })
            })
        })
            .then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            })
            .then(function (r) {
                setLoading(false);
                if (r.ok && r.data && (r.data.status === 'ok' || r.data.status === 'updated')) {
                    toonBevestiging(r.data);
                    return;
                }
                var bericht = (r.data && r.data.bericht) ||
                    'Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail ' + CONTACT_EMAIL + '.';
                bestelError.textContent = bericht;
                bestelError.hidden = false;
                bestelError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            })
            .catch(function () {
                setLoading(false);
                bestelError.textContent = 'Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail ' + CONTACT_EMAIL + '.';
                bestelError.hidden = false;
            });
    });

    function toonBevestiging(data) {
        bestelForm.hidden = true;
        wisMelding();
        var kop = data.status === 'updated'
            ? 'We hebben jullie bestelling bijgewerkt.'
            : 'Bestelling genoteerd, dank je wel!';
        bevestiging.innerHTML =
            overzichtHtml(data.bestelling, kop) +
            '<p>Je kunt dit tot <strong>' + esc(data.deadline_tekst) + '</strong> nog aanpassen. ' +
            'Betalen doen we via een tikkie, die krijg je later.</p>' +
            '<p><a href="/">&larr; Terug naar bakkumbruist.nl</a></p>';
        bevestiging.hidden = false;
        bevestiging.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Huisnummer uit de URL (?huisnummer=12) meteen invullen en opzoeken —
    // handig vanuit de link in de aanmeldbevestiging.
    var vooraf = new URLSearchParams(window.location.search).get('huisnummer');
    if (vooraf && /^\d+$/.test(vooraf) && isValidHuisnummer(parseInt(vooraf, 10))) {
        huisInput.value = vooraf;
        zoekHuis(parseInt(vooraf, 10));
    }
})();
