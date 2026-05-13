(function () {
    'use strict';

    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    // ---------- Poll ----------
    var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwlp1na6Bmla9B6iW7UEChWrizlAChcL3naAHRzsdu4d4odqXpIpSx2NBw8CGL3qs2A/exec';
    var CONTACT_EMAIL = 'slems_verenigd1q@icloud.com';
    var STORAGE_KEY = 'bakkumbruist-poll-vote';

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

    function showSuccess() {
        form.hidden = true;
        successBox.hidden = false;
        successBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function duplicateMessage(huisnummer) {
        return 'Voor nummer ' + escapeHtml(huisnummer) + ' is al een stem uitgebracht. ' +
            'Was jij dat niet? Mail dan even naar ' +
            '<a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>. ' +
            '<a href="#" id="poll-revote">Stem alsnog opnieuw uit</a>';
    }

    function attachRevoteHandler() {
        var link = document.getElementById('poll-revote');
        if (!link) return;
        link.addEventListener('click', function (e) {
            e.preventDefault();
            try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
            clearError();
            huisnummerInput.value = '';
            huisnummerInput.focus();
        });
    }

    // Check localStorage on load: if this device already voted, show notice.
    try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            var storedNum = parseInt(stored, 10);
            if (isValidHuisnummer(storedNum)) {
                showError(duplicateMessage(storedNum));
                attachRevoteHandler();
            }
        }
    } catch (err) { /* localStorage disabled — ignore */ }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
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

        if (email && !emailInput.checkValidity()) {
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
                    try { localStorage.setItem(STORAGE_KEY, String(huisnummer)); } catch (err) {}
                    showSuccess();
                } else if (data && data.status === 'duplicate') {
                    try { localStorage.setItem(STORAGE_KEY, String(huisnummer)); } catch (err) {}
                    showError(duplicateMessage(huisnummer));
                    attachRevoteHandler();
                } else {
                    showError('Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail je stem naar <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.');
                }
            })
            .catch(function () {
                setLoading(false);
                showError('Er ging iets mis bij het versturen. Probeer het zo nog eens, of mail je stem naar <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.');
            });
    });
})();
