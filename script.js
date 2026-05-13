(function () {
    'use strict';

    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    // ---------- Poll ----------
    var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwlp1na6Bmla9B6iW7UEChWrizlAChcL3naAHRzsdu4d4odqXpIpSx2NBw8CGL3qs2A/exec';
    var CONTACT_EMAIL = 'slems_verenigd1q@icloud.com';

    var DATUM_LABELS = {
        '2026-09-12': 'zaterdag 12 september 2026',
        '2026-09-26': 'zaterdag 26 september 2026'
    };

    var form = document.getElementById('poll-form');
    if (!form) return;

    var huisnummerInput = document.getElementById('poll-huisnummer');
    var emailInput = document.getElementById('poll-email');
    var errorBox = document.getElementById('poll-error');
    var submitBtn = document.getElementById('poll-submit');
    var successBox = document.getElementById('poll-success');

    function isValidHuisnummer(n) {
        if (!Number.isInteger(n)) return false;
        if (n < 1) return false;
        if (n % 2 === 1) return n <= 77;  // oneven 1-77
        return n >= 2 && n <= 28;          // even 2-28
    }

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
        submitBtn.querySelector('.poll-submit-label').textContent =
            loading ? 'Versturen…' : 'Stem versturen';
    }

    function showSuccess(updated) {
        form.hidden = true;
        var msg = successBox.querySelector('.poll-success-msg');
        if (msg) {
            msg.innerHTML = updated
                ? '<strong>Je stem is bijgewerkt!</strong> We laten via de WhatsApp-groep weten welke datum het wordt zodra alle stemmen binnen zijn.'
                : '<strong>Bedankt voor je stem!</strong> We laten via de WhatsApp-groep weten welke datum het wordt zodra alle stemmen binnen zijn.';
        }
        successBox.hidden = false;
        successBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function datumLabel(value) {
        if (!value) return '';
        // Direct treffer (frontend stuurt ISO, dus updated/duplicate na nieuwe poll)
        if (DATUM_LABELS[value]) return DATUM_LABELS[value];
        // Sheets stuurt soms 'Sat Sep 12 2026 00:00:00 GMT+0200 ...' terug;
        // probeer dat te parsen naar YYYY-MM-DD en opnieuw te matchen.
        var d = new Date(value);
        if (!isNaN(d.getTime())) {
            var y = d.getFullYear();
            var m = d.getMonth() + 1;
            var day = d.getDate();
            var iso = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
            if (DATUM_LABELS[iso]) return DATUM_LABELS[iso];
        }
        return value;
    }

    function showDuplicatePrompt(huisnummer, existingDatum, newDatum) {
        var oldLabel = datumLabel(existingDatum);
        var newLabel = datumLabel(newDatum);

        var html =
            '<p><strong>Voor nummer ' + escapeHtml(huisnummer) + ' is al gestemd op ' + escapeHtml(oldLabel) + '.</strong></p>' +
            '<p>Wil je je stem wijzigen naar <strong>' + escapeHtml(newLabel) + '</strong>?</p>' +
            '<div class="poll-confirm-row">' +
                '<button type="button" class="btn btn-primary poll-confirm-yes" id="poll-confirm-update">Stem bijwerken</button>' +
                '<button type="button" class="btn-link poll-confirm-no" id="poll-confirm-cancel">Laat staan</button>' +
            '</div>' +
            '<p class="poll-confirm-help">Klopt het niet dat er namens jouw huis al gestemd is? Mail dan even naar <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.</p>';

        showError(html);

        document.getElementById('poll-confirm-update').addEventListener('click', function () {
            submitVote(true);
        });
        document.getElementById('poll-confirm-cancel').addEventListener('click', function () {
            clearError();
        });
    }

    function submitVote(forceUpdate) {
        clearError();

        var datum = (form.querySelector('input[name="datum"]:checked') || {}).value;
        var huisnummerRaw = huisnummerInput.value.trim();
        var huisnummer = parseInt(huisnummerRaw, 10);
        var email = emailInput.value.trim();

        if (!datum) {
            showError('Kies eerst een datum.');
            return;
        }
        if (!huisnummerRaw || !/^\d+$/.test(huisnummerRaw) || !isValidHuisnummer(huisnummer)) {
            huisnummerInput.setAttribute('aria-invalid', 'true');
            showError('Dit nummer kennen we niet op de Eikenhorst — kloppen de cijfers?');
            huisnummerInput.focus();
            return;
        }
        huisnummerInput.removeAttribute('aria-invalid');

        var emailOk = !email || (emailInput.checkValidity() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email));
        if (!emailOk) {
            emailInput.setAttribute('aria-invalid', 'true');
            showError('Het e-mailadres ziet er niet helemaal goed uit — kun je het checken?');
            emailInput.focus();
            return;
        }
        emailInput.removeAttribute('aria-invalid');

        setLoading(true);

        var payload = {
            datum: datum,
            huisnummer: huisnummer,
            email: email
        };
        if (forceUpdate) payload.update = true;

        fetch(WEBHOOK_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        })
            .then(function (res) {
                if (!res.ok) throw new Error('http ' + res.status);
                return res.json();
            })
            .then(function (data) {
                setLoading(false);
                if (data && data.status === 'ok') {
                    showSuccess(false);
                } else if (data && data.status === 'updated') {
                    showSuccess(true);
                } else if (data && data.status === 'duplicate') {
                    showDuplicatePrompt(huisnummer, data.existing_datum, datum);
                } else {
                    showError('Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail je stem naar <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.');
                }
            })
            .catch(function () {
                setLoading(false);
                showError('Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail je stem naar <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.');
            });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitVote(false);
    });
})();
