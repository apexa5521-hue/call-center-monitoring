// ============================================================
// Code.gs – Google Apps Script Web App
// ApexCare Call Center – Daily Metrics Submission Handler
// ============================================================

// Google Spreadsheet ID (from the spreadsheet URL)
var SPREADSHEET_ID = "1N5nizvJNammMierVRZ3Yt9FACZuszpo90Vpx2sWi6sA";

// Sheet tab name
var SHEET_NAME = "DailyMetrics";

// Expected columns (for documentation; row order must match appendRow call in doPost)
var HEADERS = [
  "Timestamp", "Date", "Branch", "AgentName",
  "TotalCalls", "AnsweredCalls", "UnansweredEOD",
  "CallbacksCompleted", "CallbackTimeMinutes",
  "CallIssues", "UnifiedNumberIssues", "Notes"
];

// ── Run ONCE manually from the Apps Script editor ───────────
// Select "setupKeys" from the function dropdown and click Run.
// This stores the auth keys in Script Properties.
function setupKeys() {
  PropertiesService.getScriptProperties().setProperties({
    SUPERVISOR_KEY: "RW-2026",
    QUALITY_KEY:    "QA-2026"
  });
  Logger.log("✅ Keys set: SUPERVISOR_KEY=RW-2026, QUALITY_KEY=QA-2026");
}

// ── Run ONCE to initialise the DailyMetrics sheet with headers ─
// Select "setupSheet" from the function dropdown and click Run.
function setupSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log("✅ Created sheet: " + SHEET_NAME);
  }
  // Only write headers if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp", "Date", "Branch", "AgentName",
      "TotalCalls", "AnsweredCalls", "UnansweredEOD",
      "CallbacksCompleted", "CallbackTimeMinutes",
      "CallIssues", "UnifiedNumberIssues", "Notes"
    ]);
    // Freeze the header row
    sheet.setFrozenRows(1);
    Logger.log("✅ Headers written to " + SHEET_NAME);
  } else {
    Logger.log("ℹ️ Sheet already has data – headers not overwritten.");
  }
  Logger.log("✅ setupSheet complete. Spreadsheet ID: " + SPREADSHEET_ID);
}

// ── Helpers ───────────────────────────────────────────────────

function getKeys() {
  var p = PropertiesService.getScriptProperties();
  return {
    supervisorKey: p.getProperty("SUPERVISOR_KEY") || "",
    qualityKey:    p.getProperty("QUALITY_KEY")    || ""
  };
}

function jsonOut(obj, callback) {
  var str = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + str + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(str)
    .setMimeType(ContentService.MimeType.JSON);
}

// Parses application/x-www-form-urlencoded body string into an object.
function parseFormEncoded(body) {
  var result = {};
  if (!body) return result;
  body.split("&").forEach(function(pair) {
    var idx = pair.indexOf("=");
    if (idx > -1) {
      var k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, " "));
      var v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, " "));
      result[k] = v;
    }
  });
  return result;
}

// Safely parses an integer; returns 0 for NaN or negative values.
function toNum(val) {
  var n = parseInt(val, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

// Normalises truthy-ish values to "Yes" or "No" for the sheet.
function toYesNo(val) {
  if (val === true || val === "true" || val === "Yes" || val === "yes") return "Yes";
  return "No";
}

// ── doGet – health check / auth validation / data fetch ──────
//
// Behaviour:
//   GET (no params)               → { ok:true, message:"..." }   health check
//   GET ?authKey=KEY              → { ok:true, role:"..." }  OR  { ok:false, error:"Unauthorized" }
//   GET ?authKey=QA-KEY&date=...  → spreadsheet rows (quality dashboard)
//
function doGet(e) {
  var params   = e.parameter || {};
  var callback = params.callback || null;

  try {
    // ── Health check (no data params) ────────────────────────
    var hasDataParams = params.date || params.start || params.end ||
                        params.branch || params.agent;
    if (!hasDataParams) {
      return jsonOut({ ok: true, message: "Web App is live." }, callback);
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonOut({ ok: false, error: 'Sheet "' + SHEET_NAME + '" not found.' }, callback);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonOut({ ok: true, rows: [], agents: [] }, callback);

    var hdrs = data[0];
    var tz   = Session.getScriptTimeZone();

    var rows = data.slice(1).map(function(r) {
      var obj = {};
      hdrs.forEach(function(h, i) {
        // Convert Date objects to YYYY-MM-DD strings
        if (r[i] instanceof Date) {
          obj[h] = Utilities.formatDate(r[i], tz, "yyyy-MM-dd");
        } else {
          obj[h] = r[i];
        }
      });
      return obj;
    });

    // Optional filters
    if (params.date) {
      rows = rows.filter(function(r) { return String(r.Date).slice(0,10) === params.date; });
    } else if (params.start && params.end) {
      rows = rows.filter(function(r) {
        var d = String(r.Date).slice(0, 10);
        return d >= params.start && d <= params.end;
      });
    }
    if (params.branch && params.branch !== "all") {
      rows = rows.filter(function(r) { return r.Branch === params.branch; });
    }
    if (params.agent && params.agent !== "all") {
      rows = rows.filter(function(r) { return r.AgentName === params.agent; });
    }

    var agentIdx = hdrs.indexOf("AgentName");
    var agents   = [];
    var seen     = {};
    data.slice(1).forEach(function(r) {
      var a = r[agentIdx];
      if (a && !seen[a]) { seen[a] = true; agents.push(String(a)); }
    });

    return jsonOut({ ok: true, rows: rows, agents: agents }, callback);

  } catch (err) {
    Logger.log("doGet ERROR: " + err.message);
    return jsonOut({ ok: false, error: err.message }, callback);
  }
}

// ── doPost – submit a daily report row ───────────────────────
//
// Accepts: application/x-www-form-urlencoded  (GitHub Pages no-cors method)
//          application/json                   (direct API calls / testing)
//
// Required fields: authKey, Date, Branch, AgentName
// Numeric fields:  TotalCalls, AnsweredCalls, UnansweredEOD,
//                  CallbacksCompleted, CallbackTimeMinutes
// Yes/No fields:   CallIssues, UnifiedNumberIssues
// Optional:        Notes
//
function doPost(e) {
  try {
    // ── Parse body ────────────────────────────────────────────
    var data = {};
    if (e.postData && e.postData.contents) {
      var ct = (e.postData.type || "").toLowerCase();
      if (ct.indexOf("application/json") > -1) {
        data = JSON.parse(e.postData.contents);
      } else {
        // x-www-form-urlencoded (sent by GitHub Pages via no-cors fetch)
        data = parseFormEncoded(e.postData.contents);
      }
    } else {
      data = e.parameter || {};
    }

    // ── Required field validation ─────────────────────────────
    var errs = [];
    if (!data.Date)                          errs.push("Date required");
    if (!data.Branch)                        errs.push("Branch required");
    if (!data.AgentName || !String(data.AgentName).trim()) errs.push("AgentName required");
    if (errs.length) {
      Logger.log("doPost validation errors: " + errs.join("; "));
      return jsonOut({ ok: false, error: errs.join("; ") });
    }

    // ── Numeric coercion ──────────────────────────────────────
    var total    = toNum(data.TotalCalls);
    var answered = toNum(data.AnsweredCalls);
    var unans    = toNum(data.UnansweredEOD);
    var cbcDone  = toNum(data.CallbacksCompleted);
    var cbcMins  = toNum(data.CallbackTimeMinutes);

    // ── Sheet lookup ──────────────────────────────────────────
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      Logger.log("doPost: Sheet not found: " + SHEET_NAME);
      return jsonOut({
        ok: false,
        error: 'Sheet tab "' + SHEET_NAME + '" not found. ' +
               'Please create it in the spreadsheet first.'
      });
    }

    // ── Append row ────────────────────────────────────────────
    var timestamp = new Date().toISOString();
    sheet.appendRow([
      timestamp,
      data.Date,
      data.Branch,
      String(data.AgentName).trim(),
      total,
      answered,
      unans,
      cbcDone,
      cbcMins,
      toYesNo(data.CallIssues),
      toYesNo(data.UnifiedNumberIssues),
      String(data.Notes || "").trim()
    ]);

    Logger.log("doPost: Row appended – Agent: " + data.AgentName +
               "  Date: " + data.Date +
               "  Branch: " + data.Branch);

    return jsonOut({ ok: true });

  } catch (err) {
    Logger.log("doPost ERROR: " + err.message);
    return jsonOut({ ok: false, error: err.message });
  }
}
