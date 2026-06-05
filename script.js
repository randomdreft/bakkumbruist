(function () {
    'use strict';

    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var CONTACT_EMAIL = 'slems_verenigd1q@icloud.com';
    var WHATSAPP_LINK = 'https://chat.whatsapp.com/GjjAjOYPuXJGOPXmx4aMYU?mode=gi_t';

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
    var errorBox = document.getElementById('aanmeld-error');
    var submitBtn = document.getElementById('aanmeld-submit');
    var feedbackBox = document.getElementById('aanmeld-feedback');

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
            });
        });
    });

    // "Kom je?" — toon/verberg de aantallen alleen bij "Ja"
    function huidigeKomt() {
        var checked = form.querySelector('input[name="komt"]:checked');
        return checked ? checked.value : null;
    }
    function toonAantallen() {
        var komt = huidigeKomt();
        aantallenGroep.hidden = (komt !== 'ja');
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
        feedbackBox.innerHTML = html;
        feedbackBox.hidden = false;
        feedbackBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function feedbackKomt(updated) {
        var titel = updated ? 'We hebben jullie aanmelding bijgewerkt.' : 'Top, jullie staan genoteerd!';
        toonFeedback(
            '<p class="feedback-msg"><strong>' + titel + '</strong> We houden je op de hoogte via de WhatsApp-groep. ' +
            'Over de bijdrage (tikkie) laten we later iets weten.</p>' +
            '<p class="feedback-cta"><a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">Sluit je aan bij de WhatsApp-groep →</a></p>'
        );
    }
    function feedbackKomtNiet(updated) {
        var msg = updated
            ? 'We hebben jullie aanmelding bijgewerkt — jullie zijn er dit jaar niet bij. Bedankt voor het doorgeven!'
            : 'Jammer dat jullie er dit jaar niet bij zijn — bedankt voor het doorgeven. Volgend jaar weer!';
        toonFeedback('<p class="feedback-msg"><strong>' + msg + '</strong></p>');
    }

    function getAantal(name) {
        var el = form.querySelector('[name="' + name + '"]');
        var v = parseInt(el.value, 10);
        return Number.isInteger(v) && v > 0 ? v : 0;
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

        var tm8 = getAantal('aantal_tm8');
        var n9_13 = getAantal('aantal_9_13');
        var n14_18 = getAantal('aantal_14_18');
        var volw = getAantal('aantal_volwassenen');

        if (komt === 'ja' && (tm8 + n9_13 + n14_18 + volw) < 1) {
            showError('Met hoeveel personen komen jullie? Vul minstens 1 in.');
            return;
        }

        var payload = {
            huisnummer: huisnummer,
            komt: komt,
            aantal_tm8: tm8,
            aantal_9_13: n9_13,
            aantal_14_18: n14_18,
            aantal_volwassenen: volw,
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
                    var updated = r.data.status === 'updated';
                    if (r.data.komt) feedbackKomt(updated);
                    else feedbackKomtNiet(updated);
                    return;
                }
                if (r.data && r.data.error === 'ongeldig_huisnummer') {
                    huisnummerInput.setAttribute('aria-invalid', 'true');
                    showError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
                    huisnummerInput.focus();
                    return;
                }
                if (r.data && r.data.error === 'geen_personen') {
                    showError('Met hoeveel personen komen jullie? Vul minstens 1 in.');
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
