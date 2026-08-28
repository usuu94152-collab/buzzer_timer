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
 *
 * 창구는 셋이고 권한이 다르다.
 *   1) 학생 코드   - 코드 6자리. 그 학생 본인만 열린다. 명렬 조회 불가.
 *   2) 조회 토큰   - student.html 전용. 읽기만 되고 실명도 안 나간다.
 *   3) API 키      - 선생님. 전체 명렬과 삭제까지 전부.
 * 앱은 GitHub Pages 에 공개로 올라가므로 웹앱 주소는 코드에 박혀 있다.
 * 주소는 공개돼도 되지만 API 키는 절대 박으면 안 된다. 박는 순간
 * 전교생 실명과 조회 토큰이 통째로 공개된다.
 */

var SHEET_STUDENTS = "students";
var SHEET_EVENTS = "events";
var SHEET_RECORDS = "records";

var HEADERS = {
  students: ["student_id", "class", "number", "name", "token", "active", "code"],
  events: ["event_id", "name", "unit", "direction", "order"],
  records: ["record_id", "student_id", "event_id", "value", "recorded_at", "note"],
};

// 학생이 손으로 치는 코드다. 0/O, 1/I/L 처럼 헷갈리는 글자는 뺀다.
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 6;

// 앱은 code 를 모른 채 학생을 올려보낸다. 그 6칸만 덮어쓰고 code 열(G)은 건드리지 않는다.
var STUDENT_WRITE_WIDTH = 6;

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

  // ── API 키가 필요 없는 창구들 ──

  // 학생 조회(student.html). 토큰만으로 읽기만 된다.
  if (body.mode === "portfolio") {
    return json(getPortfolio(body.s));
  }

  // 학생 로그인. 코드에 해당하는 학생 하나와 그 학생 기록만 돌려준다.
  if (body.mode === "login") {
    return json(studentLogin(body.code));
  }

  // 학생이 자기 기록을 남긴다. 남의 학생 id 를 보내도 코드로만 판정하므로 소용없다.
  if (body.mode === "record") {
    return json(studentAddRecord(body.code, body.eventId, body.value));
  }

  // 학생이 자기가 방금 잘못 잰 시기를 지운다. 자기 것이 아니면 거부된다.
  if (body.mode === "unrecord") {
    return json(studentDeleteRecord(body.code, body.recordId));
  }

  // ── 여기서부터는 선생님만 ──

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

    upsertRows(SHEET_STUDENTS, HEADERS.students, body.students || [], toStudentRow, STUDENT_WRITE_WIDTH);
    upsertRows(SHEET_EVENTS, HEADERS.events, body.events || [], toEventRow);
    upsertRows(SHEET_RECORDS, HEADERS.records, body.records || [], toRecordRow);

    // 새로 올라온 학생에게 코드를 붙여 준다. 이미 있는 코드는 그대로 둔다.
    ensureStudentCodes();
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
    sheet.setFrozenRows(1);
  }

  ensureHeader(sheet, header);

  return sheet;
}

// 헤더가 사람 손에 지워지거나 열이 늘어나도 다시 맞춰 둔다.
// 코드는 열 위치로 읽기 때문에 헤더가 틀려도 동작은 하지만, 시트를 여는 사람이 헷갈린다.
function ensureHeader(sheet, header) {
  var current = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  var same = true;

  for (var index = 0; index < header.length; index += 1) {
    if (String(current[index]) !== header[index]) {
      same = false;
      break;
    }
  }

  if (!same) {
    sheet.getRange(1, 1, 1, header.length).setNumberFormat("@").setValues([header]);
  }
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

function upsertRows(name, header, items, toRow, writeWidth) {
  if (items.length === 0) {
    return;
  }

  var width = writeWidth || header.length;
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
    var row = toRow(item).slice(0, width);
    var targetRow = rowById[String(row[0])];

    if (targetRow) {
      sheet.getRange(targetRow, 1, 1, width).setValues([row]);
    } else {
      appended.push(row);
    }
  });

  if (appended.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, width).setValues(appended);
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

// ── 학생 코드 ──

function randomCode() {
  var out = "";
  for (var index = 0; index < CODE_LENGTH; index += 1) {
    out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return out;
}

function normalizeCode(value) {
  // 학생이 소문자로 치거나 공백·하이픈을 넣어도 통과시킨다.
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * 코드가 없는 학생에게 코드를 만들어 준다.
 * 이미 있는 코드는 절대 바꾸지 않는다. 바꾸면 학생이 외운 코드가 하루아침에 죽는다.
 * 선생님이 "지금 동기화" 를 누를 때와 메뉴에서 직접 부를 때 실행된다.
 */
function ensureStudentCodes() {
  var sheet = getSheet(SHEET_STUDENTS, HEADERS.students);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return 0;
  }

  var codeColumn = HEADERS.students.indexOf("code") + 1;
  var range = sheet.getRange(2, codeColumn, lastRow - 1, 1);
  var values = range.getValues();
  var used = {};
  var filled = 0;

  values.forEach(function (row) {
    var code = normalizeCode(row[0]);
    if (code) {
      used[code] = true;
    }
  });

  for (var index = 0; index < values.length; index += 1) {
    if (normalizeCode(values[index][0])) {
      values[index][0] = normalizeCode(values[index][0]);
      continue;
    }

    var candidate = randomCode();
    // 32^6 이라 부딪힐 일은 거의 없지만, 부딪히면 같은 코드로 두 학생이 열린다.
    while (used[candidate]) {
      candidate = randomCode();
    }

    used[candidate] = true;
    values[index][0] = candidate;
    filled += 1;
  }

  range.setNumberFormat("@").setValues(values);
  return filled;
}

/** 시트 메뉴에서 한 번 눌러 전교생 코드를 채울 수 있게 한다. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("부저 타이머")
    .addItem("학생 코드 채우기", "fillStudentCodes")
    .addToUi();
}

function fillStudentCodes() {
  var filled = ensureStudentCodes();
  SpreadsheetApp.getUi().alert(filled + "명에게 새 코드를 만들었습니다. 기존 코드는 그대로입니다.");
}

function findStudentByCode(code) {
  var wanted = normalizeCode(code);

  if (wanted.length !== CODE_LENGTH) {
    return null;
  }

  var students = readRows(SHEET_STUDENTS, HEADERS.students);

  for (var index = 0; index < students.length; index += 1) {
    if (normalizeCode(students[index].code) === wanted) {
      return students[index];
    }
  }

  return null;
}

function listEventsForClient() {
  return readRows(SHEET_EVENTS, HEADERS.events).map(function (row) {
    return {
      id: String(row.event_id),
      name: String(row.name),
      unit: String(row.unit),
      direction: String(row.direction),
      order: Number(row.order),
    };
  });
}

function recordsOfStudent(studentId) {
  return readRows(SHEET_RECORDS, HEADERS.records)
    .filter(function (row) {
      return String(row.student_id) === String(studentId);
    })
    .map(function (row) {
      return {
        id: String(row.record_id),
        eventId: String(row.event_id),
        value: Number(row.value),
        recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
      };
    })
    .sort(function (left, right) {
      return left.recordedAt < right.recordedAt ? -1 : 1;
    });
}

/**
 * 학생 로그인. 자기 자신과 자기 기록, 그리고 종목 목록만 나간다.
 * 다른 학생은 한 명도 나가지 않고, 조회 토큰도 내보내지 않는다.
 */
function studentLogin(code) {
  var student = findStudentByCode(code);

  if (!student) {
    return { found: false };
  }

  return {
    found: true,
    student: {
      id: String(student.student_id),
      classNo: String(student["class"]),
      number: Number(student.number),
      name: String(student.name),
    },
    events: listEventsForClient(),
    records: recordsOfStudent(student.student_id),
  };
}

function studentAddRecord(code, eventId, value) {
  var student = findStudentByCode(code);

  if (!student) {
    return { found: false };
  }

  var events = listEventsForClient();
  var known = false;

  for (var index = 0; index < events.length; index += 1) {
    if (events[index].id === String(eventId)) {
      known = true;
      break;
    }
  }

  if (!known) {
    return { error: "unknown_event" };
  }

  var number = Number(value);

  // 음수나 말도 안 되는 값이 들어오면 성적표가 망가진다. 여기서 막는다.
  if (!isFinite(number) || number < 0 || number > 100000000) {
    return { error: "bad_value" };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    upsertRows(SHEET_RECORDS, HEADERS.records, [{
      id: Utilities.getUuid(),
      studentId: String(student.student_id),
      eventId: String(eventId),
      value: number,
      recordedAt: new Date().toISOString(),
      note: "student",
    }], toRecordRow);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, records: recordsOfStudent(student.student_id) };
}

/** 자기 기록만 지울 수 있다. 남의 record_id 를 보내면 아무 일도 일어나지 않는다. */
function studentDeleteRecord(code, recordId) {
  var student = findStudentByCode(code);

  if (!student) {
    return { found: false };
  }

  var mine = recordsOfStudent(student.student_id).filter(function (record) {
    return record.id === String(recordId);
  });

  if (mine.length === 0) {
    return { error: "not_yours" };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    deleteRows(SHEET_RECORDS, HEADERS.records, 1, [String(recordId)]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, records: recordsOfStudent(student.student_id) };
}

// ── 선생님 ──

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
        code: normalizeCode(row.code),
      };
    }),
    events: listEventsForClient(),
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
  listEventsForClient().forEach(function (event) {
    events[event.id] = { name: event.name, unit: event.unit, direction: event.direction };
  });

  return {
    found: true,
    label: matched["class"] + " " + matched.number + "번",
    events: events,
    records: recordsOfStudent(matched.student_id),
  };
}
