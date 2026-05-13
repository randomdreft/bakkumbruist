/**
 * Bakkum Bruist 2026 — datum-poll webhook.
 *
 * Verwacht een POST met JSON body: { datum, huisnummer, email }
 * Schrijft een rij naar het actieve sheet en geeft JSON terug.
 *
 * Response:
 *   { status: "ok" }         — stem opgeslagen
 *   { status: "duplicate" }  — dit huisnummer heeft al gestemd
 *   { status: "error", message: "..." } — iets ging mis
 *
 * Verwachte sheet-kolommen (rij 1, in deze volgorde):
 *   timestamp | datum | huisnummer | email | user_agent
 */

var SHEET_NAME = 'Stemmen';

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ status: 'error', message: 'no body' });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut({ status: 'error', message: 'invalid json' });
    }

    var datum = String(body.datum || '').trim();
    var huisnummer = parseInt(body.huisnummer, 10);
    var email = String(body.email || '').trim();
    var userAgent = (e.parameter && e.parameter.ua) || '';

    if (!datum || !isValidDatum(datum)) {
      return jsonOut({ status: 'error', message: 'invalid datum' });
    }
    if (!isValidHuisnummer(huisnummer)) {
      return jsonOut({ status: 'error', message: 'invalid huisnummer' });
    }

    var sheet = getSheet();
    if (huisnummerExists(sheet, huisnummer)) {
      return jsonOut({ status: 'duplicate' });
    }

    sheet.appendRow([
      new Date(),
      datum,
      huisnummer,
      email,
      userAgent
    ]);

    return jsonOut({ status: 'ok' });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}

function doGet() {
  return jsonOut({ status: 'error', message: 'POST only' });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  // Header aanmaken als sheet leeg is
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'datum', 'huisnummer', 'email', 'user_agent']);
  }
  return sheet;
}

function huisnummerExists(sheet, huisnummer) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, 3, lastRow - 1, 1).getValues();  // kolom C
  for (var i = 0; i < values.length; i++) {
    if (parseInt(values[i][0], 10) === huisnummer) return true;
  }
  return false;
}

function isValidHuisnummer(n) {
  if (!Number.isInteger(n)) return false;
  if (n < 1) return false;
  if (n % 2 === 1) return n <= 77;
  return n >= 2 && n <= 28;
}

function isValidDatum(d) {
  return ['2026-08-29', '2026-09-05', '2026-09-12', '2026-09-26'].indexOf(d) !== -1;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
