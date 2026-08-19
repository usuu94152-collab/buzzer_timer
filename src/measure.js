import { listEvents, listStudents, listRecords, addRecord, deleteRecord, saveEvent, deleteEvent, bestValue } from "./store.js";
import { formatValue, parseValueInput, UNIT_LABELS } from "./format.js";
import { pushInBackground } from "./sync.js";

const EVENT_KEY = "measure.eventId";
const CLASS_KEY = "measure.classNo";

const elements = {};

// 학생이 바뀌면 타이머를 0 으로 되돌려야 한다. app.js 가 자기 리셋 함수를 넘겨준다.
let onStudentChange = () => {};

const state = {
  events: [],
  students: [],
  records: [],
  eventId: localStorage.getItem(EVENT_KEY) || "",
  classNo: localStorage.getItem(CLASS_KEY) || "",
  // "pick" 은 학생을 고르는 목록, "timer" 는 고른 학생의 타이머 화면이다.
  step: "pick",
  // 빈 문자열이면 학생 없이 스톱워치만 쓰는 상태다.
  studentId: "",
};

function currentEvent() {
  return state.events.find((event) => event.id === state.eventId) || null;
}

function currentStudent() {
  return state.students.find((student) => student.id === state.studentId) || null;
}

function currentIndex() {
  return state.students.findIndex((student) => student.id === state.studentId);
}

function isTimedEvent() {
  const event = currentEvent();
  return Boolean(event) && event.unit === "ms";
}

// 부저는 Enter 로 들어온다. 목록 화면에서까지 받으면 안 보이는 타이머가 돌아간다.
export function isTimerStep() {
  return state.step === "timer";
}

// 학생을 고른 상태에서만 시기마다 0 에서 다시 잰다. 학생 없이 재기는 평범한 스톱워치다.
export function isMeasureActive() {
  return state.step === "timer" && Boolean(currentStudent());
}

// app.js 가 정지 시점에 호출한다.
export function canRecordElapsed() {
  return isMeasureActive() && isTimedEvent();
}

export async function recordElapsed(milliseconds) {
  const student = currentStudent();
  if (!student) {
    return;
  }

  // performance.now() 는 소수점 이하까지 준다. 스톱워치에 그 정밀도는 의미가 없다.
  await addRecord({ studentId: student.id, eventId: state.eventId, value: Math.round(milliseconds) });
  // 저장해도 이 학생 화면에 머무른다. 부저를 다시 누르면 그대로 다음 시기를 잰다.
  await render();
  pushInBackground();
}

function recordsFor(studentId) {
  return state.records.filter((record) => record.studentId === studentId);
}

function measuredToday(studentId) {
  const today = new Date().toDateString();
  return recordsFor(studentId).some((record) => new Date(record.recordedAt).toDateString() === today);
}

async function openTimer(studentId) {
  state.studentId = studentId;
  state.step = "timer";
  onStudentChange();
  await render();
}

async function backToList() {
  state.step = "pick";
  state.studentId = "";
  await render();
}

async function moveStudent(offset) {
  const index = currentIndex();
  const next = index === -1 ? null : state.students[index + offset];

  if (next) {
    await openTimer(next.id);
  }
}

function fillSelect(select, items, selectedValue, emptyLabel) {
  const options = items.map((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    option.selected = item.value === selectedValue;
    return option;
  });

  if (options.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    options.push(option);
  }

  select.replaceChildren(...options);
}

function createQueueRow(student, event) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  const label = document.createElement("span");
  const name = document.createElement("strong");
  const value = document.createElement("span");
  const records = recordsFor(student.id);
  const best = event ? bestValue(records, event.direction) : null;

  button.type = "button";
  button.className = "queue-row";
  if (measuredToday(student.id)) {
    button.classList.add("is-done");
  }

  label.className = "row-label";
  label.textContent = `${student.number}번`;
  name.textContent = student.name;

  value.className = "queue-value";
  value.textContent = best === null ? "-" : formatValue(best, event.unit);
  if (records.length > 1) {
    value.textContent += ` (${records.length}회)`;
  }

  button.append(label, name, value);
  button.addEventListener("click", () => openTimer(student.id));
  item.append(button);

  return item;
}

function renderQueue() {
  const event = currentEvent();

  if (state.students.length === 0) {
    const empty = document.createElement("li");
    empty.className = "queue-empty";
    empty.textContent = state.classNo ? "이 반에 학생이 없습니다." : "명렬 탭에서 학생을 먼저 등록하세요.";
    elements.queue.replaceChildren(empty);
    elements.pickHint.textContent = "";
    return;
  }

  elements.pickHint.textContent = event
    ? `${event.name} · 이름을 누르면 타이머가 열립니다.`
    : "설정 탭에서 종목을 먼저 추가하세요.";
  elements.queue.replaceChildren(...state.students.map((student) => createQueueRow(student, event)));
}

function renderTimerHead() {
  const student = currentStudent();
  const event = currentEvent();

  if (student) {
    elements.currentName.textContent = student.name;
    elements.currentLabel.textContent = `${student.classNo} ${student.number}번 · ${event ? event.name : "종목 없음"}`;
  } else {
    elements.currentName.textContent = "학생 없이 재기";
    elements.currentLabel.textContent = "기록은 저장되지 않습니다";
  }

  // 학생 없이 재는 중이면 기록과 관련된 것은 전부 숨긴다.
  elements.panel.hidden = !student;

  const manual = Boolean(student) && Boolean(event) && event.unit !== "ms";
  elements.manualForm.hidden = !manual;
  if (manual) {
    elements.manualValue.placeholder = `${UNIT_LABELS[event.unit]} 입력`;
  }

  elements.timedHint.hidden = manual;

  const index = currentIndex();
  elements.backButton.disabled = index <= 0;
  elements.skipButton.disabled = index === -1 || index >= state.students.length - 1;
}

function createAttemptRow(record, event, attemptNumber, best) {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const value = document.createElement("strong");
  const removeButton = document.createElement("button");

  item.className = "attempt-row";

  label.className = "row-label";
  label.textContent = `${attemptNumber}시기`;

  value.textContent = formatValue(record.value, event.unit);
  if (record.value === best) {
    value.classList.add("is-best");
  }

  removeButton.type = "button";
  removeButton.className = "text-button compact danger";
  removeButton.textContent = "삭제";
  removeButton.addEventListener("click", async () => {
    await deleteRecord(record.id);
    await render();
    pushInBackground();
  });

  item.append(label, value, removeButton);
  return item;
}

function renderAttempts() {
  const student = currentStudent();
  const event = currentEvent();

  if (!student || !event) {
    elements.attemptList.replaceChildren();
    elements.attemptCount.textContent = "";
    return;
  }

  const records = recordsFor(student.id);
  const best = bestValue(records, event.direction);

  elements.attemptCount.textContent =
    records.length === 0 ? "아직 없음" : `${records.length}회 · 최고 ${formatValue(best, event.unit)}`;

  elements.attemptList.replaceChildren(
    ...[...records]
      .reverse()
      .map((record, index) => createAttemptRow(record, event, records.length - index, best))
  );
}

export async function render() {
  state.events = await listEvents();

  if (!state.events.some((event) => event.id === state.eventId)) {
    state.eventId = state.events[0]?.id || "";
  }

  const allStudents = await listStudents();
  const classes = [...new Set(allStudents.map((student) => student.classNo))];

  if (!classes.includes(state.classNo)) {
    state.classNo = classes[0] || "";
  }

  state.students = allStudents.filter((student) => student.classNo === state.classNo);
  state.records = state.eventId ? await listRecords({ eventId: state.eventId }) : [];

  // 고른 학생이 지워졌거나 다른 반으로 옮겨졌으면 목록으로 되돌린다.
  if (state.step === "timer" && state.studentId && !currentStudent()) {
    state.step = "pick";
    state.studentId = "";
  }

  fillSelect(
    elements.eventSelect,
    state.events.map((event) => ({ value: event.id, label: event.name })),
    state.eventId,
    "종목 없음"
  );
  fillSelect(
    elements.classSelect,
    classes.map((classNo) => ({ value: classNo, label: classNo })),
    state.classNo,
    "반 없음"
  );

  elements.pickStep.hidden = state.step !== "pick";
  elements.timerStep.hidden = state.step !== "timer";

  renderQueue();
  renderTimerHead();
  renderAttempts();
  renderEventManager();
}

function renderEventManager() {
  const rows = state.events.map((event) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const removeButton = document.createElement("button");

    name.textContent = event.name;
    meta.className = "row-label";
    meta.textContent = `${UNIT_LABELS[event.unit]} · ${event.direction === "lower" ? "낮을수록 좋음" : "높을수록 좋음"}`;

    removeButton.type = "button";
    removeButton.className = "text-button compact danger";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", async () => {
      if (!confirm(`${event.name} 종목과 이 종목의 모든 기록을 삭제합니다.`)) {
        return;
      }
      await deleteEvent(event.id);
      await render();
    });

    item.append(name, meta, removeButton);
    return item;
  });

  elements.eventList.replaceChildren(...rows);
}

async function onManualSubmit(submitEvent) {
  submitEvent.preventDefault();

  const event = currentEvent();
  const student = currentStudent();
  if (!event || !student) {
    return;
  }

  const value = parseValueInput(elements.manualValue.value, event.unit);
  if (value === null) {
    elements.manualValue.focus();
    return;
  }

  await addRecord({ studentId: student.id, eventId: state.eventId, value });
  elements.manualValue.value = "";
  await render();
  elements.manualValue.focus();
  pushInBackground();
}

async function onEventSubmit(submitEvent) {
  submitEvent.preventDefault();

  const name = elements.eventName.value.trim();
  if (!name) {
    return;
  }

  const saved = await saveEvent({
    name,
    unit: elements.eventUnit.value,
    direction: elements.eventDirection.value,
  });

  elements.eventName.value = "";
  state.eventId = saved.id;
  localStorage.setItem(EVENT_KEY, state.eventId);
  await render();
}

export function initMeasure({ onStudentChange: handler } = {}) {
  if (handler) {
    onStudentChange = handler;
  }

  elements.pickStep = document.querySelector("#pickStep");
  elements.timerStep = document.querySelector("#timerStep");
  elements.eventSelect = document.querySelector("#measureEvent");
  elements.classSelect = document.querySelector("#measureClass");
  elements.pickHint = document.querySelector("#pickHint");
  elements.freeRunButton = document.querySelector("#freeRunButton");
  elements.queue = document.querySelector("#measureQueue");
  elements.backToList = document.querySelector("#backToList");
  elements.panel = document.querySelector("#measurePanel");
  elements.currentName = document.querySelector("#measureCurrentName");
  elements.currentLabel = document.querySelector("#measureCurrentLabel");
  elements.skipButton = document.querySelector("#measureSkip");
  elements.backButton = document.querySelector("#measureBack");
  elements.manualForm = document.querySelector("#manualForm");
  elements.manualValue = document.querySelector("#manualValue");
  elements.timedHint = document.querySelector("#measureTimedHint");
  elements.attemptList = document.querySelector("#attemptList");
  elements.attemptCount = document.querySelector("#attemptCount");
  elements.eventForm = document.querySelector("#eventForm");
  elements.eventName = document.querySelector("#eventName");
  elements.eventUnit = document.querySelector("#eventUnit");
  elements.eventDirection = document.querySelector("#eventDirection");
  elements.eventList = document.querySelector("#eventList");

  elements.eventSelect.addEventListener("change", async () => {
    state.eventId = elements.eventSelect.value;
    localStorage.setItem(EVENT_KEY, state.eventId);
    await render();
  });

  elements.classSelect.addEventListener("change", async () => {
    state.classNo = elements.classSelect.value;
    localStorage.setItem(CLASS_KEY, state.classNo);
    // 반이 바뀌면 고른 학생도 의미가 없다.
    state.step = "pick";
    state.studentId = "";
    await render();
  });

  elements.freeRunButton.addEventListener("click", () => openTimer(""));
  elements.backToList.addEventListener("click", backToList);
  elements.backButton.addEventListener("click", () => moveStudent(-1));
  elements.skipButton.addEventListener("click", () => moveStudent(1));
  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.eventForm.addEventListener("submit", onEventSubmit);
}
