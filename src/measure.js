import { listEvents, listStudents, listRecords, addRecord, saveEvent, deleteEvent } from "./store.js";
import { formatValue, parseValueInput, UNIT_LABELS } from "./format.js";
import { pushInBackground } from "./sync.js";

const EVENT_KEY = "measure.eventId";
const CLASS_KEY = "measure.classNo";

const elements = {};

const state = {
  events: [],
  students: [],
  records: [],
  eventId: localStorage.getItem(EVENT_KEY) || "",
  classNo: localStorage.getItem(CLASS_KEY) || "",
  cursor: 0,
  active: false,
};

function currentEvent() {
  return state.events.find((event) => event.id === state.eventId) || null;
}

function currentStudent() {
  return state.students[state.cursor] || null;
}

function isTimedEvent() {
  const event = currentEvent();
  return Boolean(event) && event.unit === "ms";
}

export function isMeasureActive() {
  return state.active;
}

// app.js 가 정지 시점에 호출한다. 측정 모드가 아니면 기존 스톱워치처럼 동작한다.
export function canRecordElapsed() {
  return state.active && isTimedEvent() && Boolean(currentStudent());
}

export async function recordElapsed(milliseconds) {
  const student = currentStudent();
  if (!student) {
    return;
  }

  // performance.now() 는 소수점 이하까지 준다. 스톱워치에 그 정밀도는 의미가 없다.
  await addRecord({ studentId: student.id, eventId: state.eventId, value: Math.round(milliseconds) });
  advance();
  await render();
  pushInBackground();
}

function advance() {
  state.cursor = Math.min(state.cursor + 1, state.students.length);
}

function measuredToday(studentId) {
  const today = new Date().toDateString();
  return state.records.some(
    (record) => record.studentId === studentId && new Date(record.recordedAt).toDateString() === today
  );
}

function firstPendingIndex() {
  const index = state.students.findIndex((student) => !measuredToday(student.id));
  return index === -1 ? state.students.length : index;
}

function latestRecordFor(studentId) {
  const found = state.records.filter((record) => record.studentId === studentId);
  return found.length > 0 ? found[found.length - 1] : null;
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

function renderQueue() {
  const event = currentEvent();

  const rows = state.students.map((student, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const name = document.createElement("strong");
    const value = document.createElement("span");
    const record = latestRecordFor(student.id);

    item.className = "queue-row";
    if (state.active && index === state.cursor) {
      item.classList.add("is-current");
    }
    if (measuredToday(student.id)) {
      item.classList.add("is-done");
    }

    label.className = "row-label";
    label.textContent = `${student.number}번`;
    name.textContent = student.name;
    value.className = "queue-value";
    value.textContent = record && event ? formatValue(record.value, event.unit) : "-";

    item.append(label, name, value);
    item.addEventListener("click", () => {
      state.cursor = index;
      renderCurrent();
      renderQueue();
    });

    return item;
  });

  elements.queue.replaceChildren(...rows);
}

function renderCurrent() {
  const event = currentEvent();
  const student = currentStudent();
  const done = state.students.length > 0 && state.cursor >= state.students.length;

  elements.toggle.textContent = state.active ? "측정 종료" : "측정 시작";
  elements.toggle.classList.toggle("is-active", state.active);
  elements.panel.hidden = !state.active;

  if (!state.active) {
    return;
  }

  if (done) {
    elements.currentName.textContent = "명단 끝";
    elements.currentLabel.textContent = `${state.students.length}명 완료`;
  } else if (student) {
    elements.currentName.textContent = student.name;
    elements.currentLabel.textContent = `${student.classNo} ${student.number}번`;
  } else {
    elements.currentName.textContent = "학생 없음";
    elements.currentLabel.textContent = "명렬 탭에서 학생을 먼저 등록하세요";
  }

  const next = state.students[state.cursor + 1];
  elements.nextName.textContent = next ? `다음 ${next.number}번 ${next.name}` : "";

  const manual = Boolean(event) && event.unit !== "ms" && Boolean(student) && !done;
  elements.manualForm.hidden = !manual;
  if (manual) {
    elements.manualValue.placeholder = `${UNIT_LABELS[event.unit]} 입력`;
  }

  elements.timedHint.hidden = manual || !student || done;
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

  renderCurrent();
  renderQueue();
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
  advance();
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

export function initMeasure() {
  elements.eventSelect = document.querySelector("#measureEvent");
  elements.classSelect = document.querySelector("#measureClass");
  elements.toggle = document.querySelector("#measureToggle");
  elements.panel = document.querySelector("#measurePanel");
  elements.currentName = document.querySelector("#measureCurrentName");
  elements.currentLabel = document.querySelector("#measureCurrentLabel");
  elements.nextName = document.querySelector("#measureNextName");
  elements.skipButton = document.querySelector("#measureSkip");
  elements.backButton = document.querySelector("#measureBack");
  elements.manualForm = document.querySelector("#manualForm");
  elements.manualValue = document.querySelector("#manualValue");
  elements.timedHint = document.querySelector("#measureTimedHint");
  elements.queue = document.querySelector("#measureQueue");
  elements.eventForm = document.querySelector("#eventForm");
  elements.eventName = document.querySelector("#eventName");
  elements.eventUnit = document.querySelector("#eventUnit");
  elements.eventDirection = document.querySelector("#eventDirection");
  elements.eventList = document.querySelector("#eventList");

  elements.eventSelect.addEventListener("change", async () => {
    state.eventId = elements.eventSelect.value;
    localStorage.setItem(EVENT_KEY, state.eventId);
    await render();
    state.cursor = firstPendingIndex();
    renderCurrent();
    renderQueue();
  });

  elements.classSelect.addEventListener("change", async () => {
    state.classNo = elements.classSelect.value;
    localStorage.setItem(CLASS_KEY, state.classNo);
    await render();
    state.cursor = firstPendingIndex();
    renderCurrent();
    renderQueue();
  });

  elements.toggle.addEventListener("click", async () => {
    state.active = !state.active;
    if (state.active) {
      await render();
      state.cursor = firstPendingIndex();
    }
    renderCurrent();
    renderQueue();
  });

  elements.skipButton.addEventListener("click", () => {
    advance();
    renderCurrent();
    renderQueue();
  });

  elements.backButton.addEventListener("click", () => {
    state.cursor = Math.max(state.cursor - 1, 0);
    renderCurrent();
    renderQueue();
  });

  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.eventForm.addEventListener("submit", onEventSubmit);
}
