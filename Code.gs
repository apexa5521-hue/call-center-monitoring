// ============================================================
// ApexCare Call Center – Google Apps Script (Code.gs)
// ============================================================

const SHEET_NAME = "DailyMetrics";
const HEADERS = [
  "Timestamp","Date","Branch","AgentName",
  "TotalCalls","AnsweredCalls","UnansweredEOD",
  "CallbacksCompleted","CallbackTimeMinutes",
  "LateMessages","OpenChatsEOD",
  "CallIssues","UnifiedNumberIssues","Notes"
];

// ── Run this ONCE manually from Apps Script editor ──────────
function setupKeys() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    SUPERVISOR_KEY: "RW-2026",
    QUALITY_KEY:    "QA-2026"
  });
  Logger.log("Keys set successfully.");
}

// ── Helpers ─────────────────────────────────────────────────
function getKeys() {
  const props = PropertiesService.getScriptProperties();
  return {
    supervisorKey: props.getProperty("SUPERVISOR_KEY"),
    qualityKey:    props.getProperty("QUALITY_KEY")
  };
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    const hdr = sheet.getRange(1, 1, 1, HEADERS.length);
    hdr.setBackground("#0f172a");
    hdr.setFontColor("#ffffff");
    hdr.setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── doPost ───────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { supervisorKey, qualityKey } = getKeys();
    const provided = (body.authKey || "").trim();

    if (provided !== supervisorKey && provided !== qualityKey) {
      return jsonOut({ ok: false, error: "Unauthorized" });
    }

    // Server-side validation
    const errs = [];
    if (!body.date)      errs.push("date required");
    if (!body.branch || !["مركز الاتصال","عنيزة"].includes(body.branch))
      errs.push("valid branch required");
    if (!body.agentName || !body.agentName.trim())
      errs.push("agentName required");

    const numFields = ["totalCalls","answeredCalls","unansweredEOD",
                       "callbacksCompleted","callbackTimeMinutes",
                       "lateMessages","openChatsEOD"];
    const n = {};
    for (const f of numFields) {
      const v = Number(body[f]);
      if (isNaN(v) || v < 0) errs.push(f + " must be >= 0");
      n[f] = v;
    }
    if (!isNaN(n.answeredCalls) && !isNaN(n.totalCalls) && n.answeredCalls > n.totalCalls)
      errs.push("answeredCalls > totalCalls");
    if (!isNaN(n.unansweredEOD) && !isNaN(n.totalCalls) && n.unansweredEOD > n.totalCalls)
      errs.push("unansweredEOD > totalCalls");

    if (errs.length) return jsonOut({ ok: false, error: errs.join("; ") });

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date().toISOString(),
      body.date,
      body.branch,
      body.agentName.trim(),
      n.totalCalls,
      n.answeredCalls,
      n.unansweredEOD,
      n.callbacksCompleted,
      n.callbackTimeMinutes,
      n.lateMessages,
      n.openChatsEOD,
      body.callIssues          === true || body.callIssues          === "true" ? "Yes" : "No",
      body.unifiedNumberIssues === true || body.unifiedNumberIssues === "true" ? "Yes" : "No",
      (body.notes || "").trim()
    ]);

    return jsonOut({ ok: true });

  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// ── doGet ────────────────────────────────────────────────────
function doGet(e) {
  try {
    const params = e.parameter || {};
    const { qualityKey } = getKeys();
    const provided = (params.authKey || "").trim();

    if (provided !== qualityKey) {
      return jsonOut({ ok: false, error: "Unauthorized" });
    }

    const sheet = getOrCreateSheet();
    const data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonOut({ ok: true, rows: [] });

    const hdrs = data[0];
    let rows = data.slice(1).map(r => {
      const obj = {};
      hdrs.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });

    // Filter by date or range
    if (params.date) {
      rows = rows.filter(r => r.Date === params.date);
    } else if (params.start && params.end) {
      rows = rows.filter(r => r.Date >= params.start && r.Date <= params.end);
    }
    if (params.branch && params.branch !== "all")
      rows = rows.filter(r => r.Branch === params.branch);
    if (params.agent && params.agent !== "all")
      rows = rows.filter(r => r.AgentName === params.agent);

    // Distinct agents list
    const allRows = data.slice(1).map(r => r[hdrs.indexOf("AgentName")]).filter(Boolean);
    const agents  = [...new Set(allRows)];

    return jsonOut({ ok: true, rows, agents });

  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}
