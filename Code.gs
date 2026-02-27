// ============================================================
// Code.gs – Google Apps Script Web App
// ApexCare Call Center – Daily Metrics Submission Handler
// ============================================================

// Sheet tab name – must exist in the bound spreadsheet
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

// ── Helpers ───────────────────────────────────────────────────

function getKeys() {
  var p = PropertiesService.getScriptProperties();
  return {
    supervisorKey: p.getProperty("SUPERVISOR_KEY") || "",
    qualityKey:    p.getProperty("QUALITY_KEY")    || ""
  };
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
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
  try {
    var params   = e.parameter || {};
    var provided = (params.authKey || "").trim();

    // ── Health check (no authKey supplied) ───────────────────
    if (!provided) {
      return jsonOut({ ok: true, message: "Web App is live." });
    }

    // ── Validate key ─────────────────────────────────────────
    var keys      = getKeys();
    var isSuper   = (provided === keys.supervisorKey);
    var isQuality = (provided === keys.qualityKey);

    if (!isSuper && !isQuality) {
      Logger.log("doGet: Unauthorized attempt with key: " + provided);
      return jsonOut({ ok: false, error: "Unauthorized" });
    }

    // ── Auth-only (no data params) – used by supervisor login ─
    var hasDataParams = params.date || params.start || params.end ||
                        params.branch || params.agent;
    if (!hasDataParams) {
      return jsonOut({ ok: true, role: isQuality ? "quality" : "supervisor" });
    }

    // ── Data fetch – requires quality key ────────────────────
    if (!isQuality) {
      return jsonOut({ ok: false, error: "Quality key required for data access." });
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonOut({ ok: false, error: 'Sheet "' + SHEET_NAME + '" not found.' });
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonOut({ ok: true, rows: [], agents: [] });

    var hdrs = data[0];
    var rows = data.slice(1).map(function(r) {
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });

    // Optional filters
    if (params.date) {
      rows = rows.filter(function(r) { return r.Date === params.date; });
    } else if (params.start && params.end) {
      rows = rows.filter(function(r) { return r.Date >= params.start && r.Date <= params.end; });
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
      if (a && !seen[a]) { seen[a] = true; agents.push(a); }
    });

    return jsonOut({ ok: true, rows: rows, agents: agents });

  } catch (err) {
    Logger.log("doGet ERROR: " + err.message);
    return jsonOut({ ok: false, error: err.message });
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

    // ── Auth ──────────────────────────────────────────────────
    var keys     = getKeys();
    var provided = (data.authKey || "").trim();
    if (!provided ||
        (provided !== keys.supervisorKey && provided !== keys.qualityKey)) {
      Logger.log("doPost: Unauthorized key: " + provided);
      return jsonOut({ ok: false, error: "Unauthorized" });
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
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
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
