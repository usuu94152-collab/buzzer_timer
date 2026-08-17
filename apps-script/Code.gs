/**
 * 부저 타이머 백엔드 (Google Apps Script 웹앱)
 *
 * 배포 설정 - 이 두 가지가 보안의 전부다.
 *   실행:          나
 *   액세스 권한:   모든 사용자
 * 이렇게 두면 익명 방문자는 이 스크립트가 돌려주는 JSON 만 보고
 * 스프레드시트 자체에는 접근하지 못한다.
 * 스프레드시트 공유는 "제한됨(나만)" 그대로 두어야 한다.
 *
 * API 키는 코드에 적지 않는다.
 *   프로젝트 설정 > 스크립트 속성 에 API_KEY 를 추가한다.
 */

var SHEET_STUDENTS = "students";
var SHEET_EVENTS = "events";
var SHEET_RECORDS = "records";

var HEADERS = {
  students: ["student_id", "class", "number", "name", "token", "active"],
  events: ["event_id", "name", "unit", "direction", "order"],
  records: ["record_id", "student_id", "event_id", "value", "recorded_at", "note"],
};

/** 조회도 전부 POST 로 받는다. 토큰과 API 키가 URL 에 남지 않게 하기 위해서다. */
function doGet() {
  return json({ error: "bad_request" });
}

// 오류가 그대로 새어 나가면 Apps Script 가 HTML 오류 페이지를 돌려주고
// 앱에서는 "형식이 이상하다" 는 알아보기 힘든 메시지만 보인다.
function doPost(request) {
  try {
    return handlePost(request);
  } catch (error) {
    return json({ error: String(error.message || error) });
  }
}

function handlePost(request) {
  var body;

  try {
    body = JSON.parse(request.postData.contents);
  } catch (error) {
    return json({ error: "bad_request" });
  }

  // 학생 조회는 API 키 없이 토큰만으로 처리한다. 여기가 유일한 공개 창구다.
  if (body.mode === "portfolio") {
    return json(getPortfolio(body.s));
  }

  if (!hasValidKey(body.key)) {
    return json({ error: "unauthorized" });
  }

  if (body.mode === "roster") {
    return json(getRoster());
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  var removed = body["delete"] || {};

  try {
    // 삭제를 먼저 처리해야 같은 요청에서 다시 올라온 항목이 살아남는다.
    deleteRows(SHEET_RECORDS, HEADERS.records, 2, removed.students || []);
    deleteRows(SHEET_RECORDS, HEADERS.records, 3, removed.events || []);
    deleteRows(SHEET_RECORDS, HEADERS.records, 1, removed.records || []);
    deleteRows(SHEET_STUDENTS, HEADERS.students, 1, removed.students || []);
    deleteRows(SHEET_EVENTS, HEADERS.events, 1, removed.events || []);

    upsertRows(SHEET_STUDENTS, HEADERS.students, body.students || [], toStudentRow);
    upsertRows(SHEET_EVENTS, HEADERS.events, body.events || [], toEventRow);
    upsertRows(SHEET_RECORDS, HEADERS.records, body.records || [], toRecordRow);
  } finally {
    lock.releaseLock();
  }

  return json({
    ok: true,
    students: (body.students || []).length,
    events: (body.events || []).length,
    records: (body.records || []).length,
  });
}

function hasValidKey(candidate) {
  var expected = PropertiesService.getScriptProperties().getProperty("API_KEY");
  return Boolean(expected) && candidate === expected;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * SPREADSHEET_ID 속성이 있으면 무조건 그 시트를 쓴다.
 * 활성 문서를 먼저 보면 안 된다. 스크립트가 예전에 다른 시트에 묶여 있던 경우
 * 지정한 시트를 무시하고 엉뚱한 시트에 조용히 기록한다.
 * 속성이 없을 때만 활성 문서로 넘어간다.
 */
function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");

  if (id) {
    return SpreadsheetApp.openById(id);
  }

  var active = SpreadsheetApp.getActiveSpreadsheet();

  if (!active) {
    throw new Error("스크립트 속성에 SPREADSHEET_ID 를 넣어 주세요.");
  }

  return active;
}

function getSheet(name, header) {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    // 시트 전체를 서식 없는 텍스트로 둔다. 그러지 않으면 시트가 값을 멋대로 해석한다.
    // "3-2" 는 3월 2일이 되고, ISO 시각은 날짜값이 되며,
    // "12e34..." 형태의 토큰은 지수 표기 숫자로 읽혀 값이 깨진다.
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat("@");
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function readRows(name, header) {
  var sheet = getSheet(name, header);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, header.length).getValues().map(function (row) {
    var item = {};
    header.forEach(function (key, index) {
      item[key] = row[index];
    });
    return item;
  });
}

function upsertRows(name, header, items, toRow) {
  if (items.length === 0) {
    return;
  }

  var sheet = getSheet(name, header);
  var lastRow = sheet.getLastRow();
  var existingIds = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (row) {
    return String(row[0]);
  });

  var rowById = {};
  existingIds.forEach(function (id, index) {
    rowById[id] = index + 2;
  });

  var appended = [];

  items.forEach(function (item) {
    var row = toRow(item);
    var targetRow = rowById[String(row[0])];

    if (targetRow) {
      sheet.getRange(targetRow, 1, 1, header.length).setValues([row]);
    } else {
      appended.push(row);
    }
  });

  if (appended.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, header.length).setValues(appended);
  }
}

/** matchColumn 이 ids 중 하나와 같은 행을 지운다. 인덱스가 밀리지 않도록 아래에서 위로 지운다. */
function deleteRows(name, header, matchColumn, ids) {
  if (ids.length === 0) {
    return;
  }

  var sheet = getSheet(name, header);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var targets = {};
  ids.forEach(function (id) {
    targets[String(id)] = true;
  });

  var values = sheet.getRange(2, matchColumn, lastRow - 1, 1).getValues();

  for (var index = values.length - 1; index >= 0; index -= 1) {
    if (targets[String(values[index][0])]) {
      sheet.deleteRow(index + 2);
    }
  }
}

function toStudentRow(student) {
  return [student.id, student.classNo, student.number, student.name, student.token, student.active ? "Y" : "N"];
}

function toEventRow(event) {
  return [event.id, event.name, event.unit, event.direction, event.order];
}

function toRecordRow(record) {
  return [record.id, record.studentId, record.eventId, record.value, record.recordedAt, record.note || ""];
}

function getRoster() {
  return {
    students: readRows(SHEET_STUDENTS, HEADERS.students).map(function (row) {
      return {
        id: String(row.student_id),
        classNo: String(row["class"]),
        number: Number(row.number),
        name: String(row.name),
        token: String(row.token),
        active: row.active !== "N",
      };
    }),
    events: readRows(SHEET_EVENTS, HEADERS.events).map(function (row) {
      return {
        id: String(row.event_id),
        name: String(row.name),
        unit: String(row.unit),
        direction: String(row.direction),
        order: Number(row.order),
      };
    }),
  };
}

/**
 * 학생 조회. 실명은 절대 내보내지 않는다.
 * 링크가 유출되어도 "3-2 15번" 까지만 드러나도록 라벨만 돌려준다.
 * 토큰이 틀리면 존재 여부를 알 수 없게 동일한 응답을 준다.
 */
function getPortfolio(token) {
  var notFound = { found: false };

  if (!token || String(token).length < 16) {
    return notFound;
  }

  var students = readRows(SHEET_STUDENTS, HEADERS.students);
  var matched = null;

  for (var index = 0; index < students.length; index += 1) {
    if (String(students[index].token) === String(token)) {
      matched = students[index];
      break;
    }
  }

  if (!matched) {
    return notFound;
  }

  var events = {};
  readRows(SHEET_EVENTS, HEADERS.events).forEach(function (row) {
    events[String(row.event_id)] = {
      name: String(row.name),
      unit: String(row.unit),
      direction: String(row.direction),
    };
  });

  var records = readRows(SHEET_RECORDS, HEADERS.records)
    .filter(function (row) {
      return String(row.student_id) === String(matched.student_id);
    })
    .map(function (row) {
      return {
        eventId: String(row.event_id),
        value: Number(row.value),
        recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
      };
    });

  return {
    found: true,
    label: matched["class"] + " " + matched.number + "번",
    events: events,
    records: records,
  };
}
