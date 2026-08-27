(function () {
    'use strict';

    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var CONTACT_EMAIL = 'slems_verenigd1q@icloud.com';
    var WHATSAPP_LINK = 'https://chat.whatsapp.com/GjjAjOYPuXJGOPXmx4aMYU?mode=gi_t';

    // Tarieven in centen. Dit zijn alleen startwaarden voor de weergave; de
    // server rekent het definitieve bedrag na en levert de echte tarieven via
    // /api/instellingen.
    var TARIEF = { dag: 1750, avond: 750 };

    // ---------- Geldige huisnummers (client-side; server is de waterdichte laag) ----------
    function isValidHuisnummer(n) {
        if (!Number.isInteger(n)) return false;
        if (n < 1) return false;
        if (n % 2 === 1) return n <= 77;   // oneven 1–77
        return n >= 2 && n <= 28;           // even 2–28
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function euro(cent) {
        return '€ ' + (cent / 100).toFixed(2).replace('.', ',');
    }

    // ---------- Openbare teller ----------
    var tellerBlok = document.getElementById('teller-blok');
    var tellerAantal = document.getElementById('teller-aantal');
    var tellerTotaal = document.getElementById('teller-totaal');
    var tellerVulling = document.getElementById('teller-vulling');

    function renderTeller(adressen, totaal) {
        if (!tellerBlok) return;
        if (typeof adressen !== 'number' || typeof totaal !== 'number' || totaal < 1) return;
        tellerAantal.textContent = adressen;
        tellerTotaal.textContent = totaal;
        var pct = Math.max(0, Math.min(100, Math.round((adressen / totaal) * 100)));
        tellerVulling.style.width = pct + '%';
        var balk = tellerBlok.querySelector('.teller-balk');
        if (balk) balk.setAttribute('aria-valuenow', String(adressen));
        tellerBlok.hidden = adressen <= 0; // pas tonen zodra er minstens één huis meedoet
    }

    function laadTeller() {
        fetch('/api/teller', { headers: { 'Accept': 'application/json' } })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) { if (data) renderTeller(data.adressen, data.totaal); })
            .catch(function () { /* stil falen — teller is niet kritisch */ });
    }
    laadTeller();

    // ---------- Formulier ----------
    var form = document.getElementById('aanmeld-form');
    if (!form) return;

    var huisnummerInput = document.getElementById('f-huisnummer');
    var aantallenGroep = document.getElementById('aantallen-groep');
    var avondBlok = document.getElementById('avond-blok');
    var avondTelling = document.getElementById('avond-telling');
    var bijdrageBlok = document.getElementById('bijdrage-blok');
    var bijdrageBedrag = document.getElementById('bijdrage-bedrag');
    var bijdrageUitleg = document.getElementById('bijdrage-uitleg');
    var errorBox = document.getElementById('aanmeld-error');
    var submitBtn = document.getElementById('aanmeld-submit');
    var feedbackBox = document.getElementById('aanmeld-feedback');
    var etenLinkBlok = document.getElementById('eten-link-blok');

    // Tarieven ophalen zodat de site geen bedragen hardcoded houdt.
    fetch('/api/instellingen', { headers: { 'Accept': 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
            if (!data || !data.tarief_cent) return;
            TARIEF = data.tarief_cent;
            var td = document.getElementById('tarief-dag');
            var ta = document.getElementById('tarief-avond');
            if (td) td.textContent = euro(TARIEF.dag) + ' per persoon';
            if (ta) ta.textContent = euro(TARIEF.avond) + ' per persoon';

            // Besteldeadline in de hero — uit de database, niet hardcoded.
            var hd = document.getElementById('hero-deadline');
            if (hd && data.bestel_deadline_tekst) hd.textContent = data.bestel_deadline_tekst;
            var hint = document.getElementById('hero-eten-hint');
            if (hint && data.bestel_deadline_verstreken) {
                hint.innerHTML = 'De bestelling voor het eten is doorgegeven aan De Toren. ' +
                    'Je kunt nog wel zien wat er voor jullie genoteerd staat.';
            }
            herbereken();
        })
        .catch(function () { /* startwaarden blijven staan */ });

    // ---------- Aantallen uitlezen ----------
    // De tellers dragen zelf hun soort (dag/avond) en leeftijdsgroep, zodat
    // een extra groep alleen HTML kost en geen JS-wijziging.
    var tellerVelden = form.querySelectorAll('input[data-soort][data-groep]');

    function leesAantallen() {
        var uit = { dag: {}, avond: {} };
        Array.prototype.forEach.call(tellerVelden, function (el) {
            var soort = el.getAttribute('data-soort');
            var groep = el.getAttribute('data-groep');
            var v = parseInt(el.value, 10);
            uit[soort][groep] = Number.isInteger(v) && v > 0 ? v : 0;
        });
        return uit;
    }
    function somVan(groep) {
        var t = 0;
        for (var k in groep) if (Object.prototype.hasOwnProperty.call(groep, k)) t += groep[k];
        return t;
    }

    // ---------- Live berekening van de bijdrage ----------
    function herbereken() {
        var a = leesAantallen();
        var dag = somVan(a.dag);
        var avond = somVan(a.avond);

        // Badge op het (mogelijk ingeklapte) avondblok
        if (avondTelling) {
            avondTelling.hidden = avond === 0;
            avondTelling.textContent = avond === 1 ? '1 avondgast' : avond + ' avondgasten';
        }

        if (!bijdrageBlok) return;
        if (huidigeKomt() !== 'ja' || (dag + avond) === 0) {
            bijdrageBlok.hidden = true;
            return;
        }
        var cent = dag * TARIEF.dag + avond * TARIEF.avond;
        bijdrageBedrag.textContent = euro(cent);
        bijdrageBlok.hidden = false;

        var delen = [];
        if (dag) delen.push(dag + (dag === 1 ? ' persoon' : ' personen') + ' de hele dag × ' + euro(TARIEF.dag));
        if (avond) delen.push(avond + (avond === 1 ? ' persoon' : ' personen') + " alleen 's avonds × " + euro(TARIEF.avond));
        bijdrageUitleg.textContent = delen.join('  +  ');
    }

    // Steppers (− / +) rond de aantallen-velden
    var steppers = document.querySelectorAll('[data-stepper]');
    Array.prototype.forEach.call(steppers, function (stepper) {
        var input = stepper.querySelector('input[type="number"]');
        var btns = stepper.querySelectorAll('.stepper-btn');
        Array.prototype.forEach.call(btns, function (btn) {
            btn.addEventListener('click', function () {
                var step = parseInt(btn.getAttribute('data-step'), 10) || 0;
                var min = parseInt(input.min, 10);
                var max = parseInt(input.max, 10);
                var v = parseInt(input.value, 10);
                if (!Number.isInteger(v)) v = 0;
                v += step;
                if (Number.isInteger(min)) v = Math.max(min, v);
                if (Number.isInteger(max)) v = Math.min(max, v);
                input.value = v;
                herbereken();
            });
        });
        if (input) input.addEventListener('input', herbereken);
    });

    // "Kom je?" — toon/verberg de aantallen alleen bij "Ja"
    function huidigeKomt() {
        var checked = form.querySelector('input[name="komt"]:checked');
        return checked ? checked.value : null;
    }
    function toonAantallen() {
        var ja = huidigeKomt() === 'ja';
        aantallenGroep.hidden = !ja;
        if (avondBlok) avondBlok.hidden = !ja;
        herbereken();
    }
    Array.prototype.forEach.call(form.querySelectorAll('input[name="komt"]'), function (radio) {
        radio.addEventListener('change', toonAantallen);
    });
    toonAantallen();

    function showError(html) {
        errorBox.innerHTML = html;
        errorBox.hidden = false;
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function clearError() {
        errorBox.innerHTML = '';
        errorBox.hidden = true;
    }

    function setLoading(loading) {
        submitBtn.disabled = loading;
        submitBtn.classList.toggle('is-loading', loading);
        submitBtn.querySelector('.form-submit-label').textContent =
            loading ? 'Versturen…' : 'Aanmelding versturen';
    }

    function toonFeedback(html) {
        form.hidden = true;
        if (etenLinkBlok) etenLinkBlok.hidden = true;
        feedbackBox.innerHTML = html;
        feedbackBox.hidden = false;
        feedbackBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function feedbackKomt(data) {
        var titel = data.status === 'updated'
            ? 'We hebben jullie aanmelding bijgewerkt.'
            : 'Top, jullie staan genoteerd!';

        var regels = '';
        if (data.dag) regels += data.dag + (data.dag === 1 ? ' persoon' : ' personen') + ' de hele dag';
        if (data.avond) regels += (regels ? ' en ' : '') + data.avond + (data.avond === 1 ? ' persoon' : ' personen') + " alleen 's avonds";

        var html = '<p class="feedback-msg"><strong>' + titel + '</strong> ' +
            (regels ? 'We noteren ' + regels + '. ' : '') +
            'Jullie bijdrage komt daarmee op <strong>' + euro(data.bijdrage_cent || 0) + '</strong>. ' +
            'Over de tikkie laten we later iets weten.</p>';

        if (data.mag_bestellen) {
            html += '<p class="feedback-eten"><a href="/eten">Bestel meteen jullie friet en snacks bij De Toren →</a></p>';
        }
        html += '<p class="feedback-cta"><a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">Sluit je aan bij de WhatsApp-groep →</a></p>';
        toonFeedback(html);
    }

    function feedbackKomtNiet(updated) {
        var msg = updated
            ? 'We hebben jullie aanmelding bijgewerkt — jullie zijn er dit jaar niet bij. Bedankt voor het doorgeven!'
            : 'Jammer dat jullie er dit jaar niet bij zijn — bedankt voor het doorgeven. Volgend jaar weer!';
        toonFeedback('<p class="feedback-msg"><strong>' + msg + '</strong></p>');
    }

    function submitAanmelding() {
        clearError();

        var huisnummerRaw = huisnummerInput.value.trim();
        var huisnummer = parseInt(huisnummerRaw, 10);
        var komt = huidigeKomt();

        if (!huisnummerRaw || !/^\d+$/.test(huisnummerRaw) || !isValidHuisnummer(huisnummer)) {
            huisnummerInput.setAttribute('aria-invalid', 'true');
            showError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
            huisnummerInput.focus();
            return;
        }
        huisnummerInput.removeAttribute('aria-invalid');

        if (komt !== 'ja' && komt !== 'nee') {
            showError('Laat je even weten of jullie komen?');
            return;
        }

        var aantallen = leesAantallen();
        var totaal = somVan(aantallen.dag) + somVan(aantallen.avond);

        if (komt === 'ja' && totaal < 1) {
            showError('Met hoeveel personen komen jullie? Vul er minstens 1 in, overdag of ’s avonds.');
            return;
        }

        var payload = {
            huisnummer: huisnummer,
            komt: komt,
            deelnemers: aantallen,
            naam: form.querySelector('[name="naam"]').value.trim(),
            contact: form.querySelector('[name="contact"]').value.trim()
        };

        setLoading(true);

        fetch('/api/aanmelding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            })
            .then(function (r) {
                setLoading(false);
                if (r.ok && r.data && (r.data.status === 'ok' || r.data.status === 'updated')) {
                    renderTeller(r.data.adressen, r.data.totaal);
                    if (r.data.komt) feedbackKomt(r.data);
                    else feedbackKomtNiet(r.data.status === 'updated');
                    return;
                }
                if (r.data && r.data.error === 'ongeldig_huisnummer') {
                    huisnummerInput.setAttribute('aria-invalid', 'true');
                    showError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
                    huisnummerInput.focus();
                    return;
                }
                if (r.data && r.data.error === 'geen_personen') {
                    showError('Met hoeveel personen komen jullie? Vul er minstens 1 in, overdag of ’s avonds.');
                    return;
                }
                if (r.data && r.data.error === 'te_veel_verzoeken') {
                    showError('Je hebt het formulier net al een paar keer verstuurd. Wacht even en probeer het opnieuw.');
                    return;
                }
                netwerkfout();
            })
            .catch(function () {
                setLoading(false);
                netwerkfout();
            });
    }

    function netwerkfout() {
        showError('Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail je aanmelding naar ' +
            '<a href="mailto:' + CONTACT_EMAIL + '">' + escapeHtml(CONTACT_EMAIL) + '</a>.');
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitAanmelding();
    });
})();
