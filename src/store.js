const DB_NAME = "buzzer-timer";
const DB_VERSION = 1;
const STUDENTS = "students";
const EVENTS = "events";
const RECORDS = "records";

const ID_BYTE_LENGTH = 8;
// 학생 조회 링크의 유일한 방어선이므로 무차별 대입이 불가능한 길이로 둔다.
const TOKEN_BYTE_LENGTH = 16;

const DEFAULT_EVENTS = [
  { name: "50m 달리기", unit: "ms", direction: "lower" },
  { name: "오래달리기-걷기", unit: "ms", direction: "lower" },
  { name: "왕복오래달리기", unit: "count", direction: "higher" },
  { name: "제자리멀리뛰기", unit: "cm", direction: "higher" },
  { name: "윗몸말아올리기", unit: "count", direction: "higher" },
  { name: "앉아윗몸앞으로굽히기", unit: "cm", direction: "higher" },
];

let databasePromise = null;

// crypto.randomUUID 는 보안 컨텍스트에서만 동작한다.
// 이 앱은 http://<LAN IP>:5190 으로도 열리므로 getRandomValues 로 만든다.
function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createToken() {
  return randomHex(TOKEN_BYTE_LENGTH);
}

function createId() {
  return randomHex(ID_BYTE_LENGTH);
}

function createSchema(database) {
  if (!database.objectStoreNames.contains(STUDENTS)) {
    const students = database.createObjectStore(STUDENTS, { keyPath: "id" });
    students.createIndex("by_class", "classNo");
  }

  if (!database.objectStoreNames.contains(EVENTS)) {
    const events = database.createObjectStore(EVENTS, { keyPath: "id" });
    DEFAULT_EVENTS.forEach((event, index) => {
      events.add({ ...event, id: createId(), order: index });
    });
  }

  if (!database.objectStoreNames.contains(RECORDS)) {
    const records = database.createObjectStore(RECORDS, { keyPath: "id" });
    records.createIndex("by_student", "studentId");
    records.createIndex("by_event", "eventId");
  }
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => createSchema(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

async function runTransaction(storeNames, mode, run) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, mode);
    let result;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    const request = run(transaction);
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
    }
  });
}

function compareStudents(left, right) {
  if (left.classNo !== right.classNo) {
    return left.classNo.localeCompare(right.classNo, "ko", { numeric: true });
  }
  return left.number - right.number;
}

export async function listStudents(classNo) {
  const students = await runTransaction(STUDENTS, "readonly", (transaction) =>
    transaction.objectStore(STUDENTS).getAll()
  );

  return students
    .filter((student) => !classNo || student.classNo === classNo)
    .sort(compareStudents);
}

export async function listClasses() {
  const students = await listStudents();
  return [...new Set(students.map((student) => student.classNo))];
}

export async function saveStudent(input) {
  const student = {
    id: input.id || createId(),
    classNo: String(input.classNo).trim(),
    number: Number(input.number),
    name: String(input.name).trim(),
    token: input.token || createToken(),
    active: input.active !== false,
  };

  await runTransaction(STUDENTS, "readwrite", (transaction) =>
    transaction.objectStore(STUDENTS).put(student)
  );

  return student;
}

function deleteByIndex(transaction, storeName, indexName, key) {
  const cursorRequest = transaction.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.only(key));

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }
    cursor.delete();
    cursor.continue();
  };
}

// 로컬에서 지운 것을 시트에서도 지우려면 무엇을 지웠는지 기억해야 한다.
// 다음 동기화 때 함께 보내고 성공하면 비운다.
const TOMBSTONE_KEYS = {
  [STUDENTS]: "sync.deleted.students",
  [EVENTS]: "sync.deleted.events",
  [RECORDS]: "sync.deleted.records",
};

function rememberDeletion(storeName, id) {
  const key = TOMBSTONE_KEYS[storeName];
  const ids = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  ids.add(id);
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function listDeletions() {
  return {
    students: JSON.parse(localStorage.getItem(TOMBSTONE_KEYS[STUDENTS]) || "[]"),
    events: JSON.parse(localStorage.getItem(TOMBSTONE_KEYS[EVENTS]) || "[]"),
    records: JSON.parse(localStorage.getItem(TOMBSTONE_KEYS[RECORDS]) || "[]"),
  };
}

export function clearDeletions() {
  Object.values(TOMBSTONE_KEYS).forEach((key) => localStorage.removeItem(key));
}

export function deleteStudent(studentId) {
  rememberDeletion(STUDENTS, studentId);
  return runTransaction([STUDENTS, RECORDS], "readwrite", (transaction) => {
    transaction.objectStore(STUDENTS).delete(studentId);
    deleteByIndex(transaction, RECORDS, "by_student", studentId);
  });
}

export async function listEvents() {
  const events = await runTransaction(EVENTS, "readonly", (transaction) =>
    transaction.objectStore(EVENTS).getAll()
  );

  return events.sort((left, right) => left.order - right.order);
}

export async function saveEvent(input) {
  const events = await listEvents();
  const event = {
    id: input.id || createId(),
    name: String(input.name).trim(),
    unit: input.unit,
    direction: input.direction,
    order: input.order ?? events.length,
  };

  await runTransaction(EVENTS, "readwrite", (transaction) =>
    transaction.objectStore(EVENTS).put(event)
  );

  return event;
}

export function deleteEvent(eventId) {
  rememberDeletion(EVENTS, eventId);
  return runTransaction([EVENTS, RECORDS], "readwrite", (transaction) => {
    transaction.objectStore(EVENTS).delete(eventId);
    deleteByIndex(transaction, RECORDS, "by_event", eventId);
  });
}

export async function listRecords(filter = {}) {
  const records = await runTransaction(RECORDS, "readonly", (transaction) =>
    transaction.objectStore(RECORDS).getAll()
  );

  return records
    .filter((record) => !filter.studentId || record.studentId === filter.studentId)
    .filter((record) => !filter.eventId || record.eventId === filter.eventId)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

export async function addRecord({ studentId, eventId, value, note = "" }) {
  const record = {
    id: createId(),
    studentId,
    eventId,
    value: Number(value),
    recordedAt: new Date().toISOString(),
    note,
  };

  await runTransaction(RECORDS, "readwrite", (transaction) =>
    transaction.objectStore(RECORDS).add(record)
  );

  return record;
}

export function deleteRecord(recordId) {
  rememberDeletion(RECORDS, recordId);
  return runTransaction(RECORDS, "readwrite", (transaction) =>
    transaction.objectStore(RECORDS).delete(recordId)
  );
}

// 저장 함수들이 syncedAt 없는 객체를 새로 만들기 때문에
// 수정된 항목은 자동으로 다시 미동기화 상태가 된다.
export async function listUnsynced() {
  const [students, events, records] = await Promise.all([listStudents(), listEvents(), listRecords()]);

  return {
    students: students.filter((item) => !item.syncedAt),
    events: events.filter((item) => !item.syncedAt),
    records: records.filter((item) => !item.syncedAt),
  };
}

export async function markSynced({ students = [], events = [], records = [] }) {
  const syncedAt = new Date().toISOString();
  const groups = [
    [STUDENTS, students],
    [EVENTS, events],
    [RECORDS, records],
  ].filter(([, items]) => items.length > 0);

  for (const [storeName, items] of groups) {
    await runTransaction(storeName, "readwrite", (transaction) => {
      const objectStore = transaction.objectStore(storeName);
      items.forEach((item) => objectStore.put({ ...item, syncedAt }));
    });
  }
}

export async function replaceRoster({ students = [], events = [] }) {
  await runTransaction([STUDENTS, EVENTS], "readwrite", (transaction) => {
    const studentStore = transaction.objectStore(STUDENTS);
    const eventStore = transaction.objectStore(EVENTS);
    students.forEach((student) => studentStore.put({ ...student, syncedAt: new Date().toISOString() }));
    events.forEach((event) => eventStore.put({ ...event, syncedAt: new Date().toISOString() }));
  });
}

export function isBetter(candidate, current, direction) {
  if (current === null || current === undefined) {
    return true;
  }
  return direction === "lower" ? candidate < current : candidate > current;
}

export function bestValue(records, direction) {
  return records.reduce(
    (best, record) => (isBetter(record.value, best, direction) ? record.value : best),
    null
  );
}
