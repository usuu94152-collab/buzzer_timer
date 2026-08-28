import { formatValue, parseValueInput, formatDate, UNIT_LABELS } from "./format.js?v=20";
import { createTimer } from "./timer.js?v=20";

/**
 * 학생용 화면.
 *
 * 웹앱 주소는 여기 박아 둔다. 학생마다 주소를 입력하게 할 수는 없다.
 * 주소는 공개돼도 되지만 API 키는 절대 여기 두면 안 된다. 두는 순간
 * 전교생 실명과 조회 토큰이 통째로 열린다.
 * 이 화면이 쓰는 창구는 코드 하나로 자기 것만 열리는 login/record/unrecord 뿐이다.
 */
const API = "https://script.google.com/macros/s/AKfycbw00WCg_sur7PntO8ooiVMr4yd4-JXl2IFKKamaIFwnTtds86FpQXycP1tVSL-U82LarA/exec";

const EVENT_KEY = "me.eventId";
const RECENT_KEY = "me.recent";
const PENDING_KEY = "me.pending";
const RECENT_LIMIT = 12;

const elements = {};
let timer = null;

const state = {
  eventId: localStorage.getItem(EVENT_KEY) || "",
  events: [],
  code: "",
  student: null,
  records: [],
  busy: false,
};

async function call(body) {
  // Content-Type 이 application/json 이면 CORS preflight 가 뜨는데
  // Apps Script 웹앱은 OPTIONS 에 답하지 못한다. text/plain 이면 preflight 가 없다.
  const response = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`서버가 ${response.status} 로 응답했습니다.`);
  }

  return response.json();
}

// ── 저장 대기열 ──
// 운동장 와이파이는 자주 끊긴다. 끊겼다고 방금 뛴 기록을 버릴 수는 없다.

function readPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch {
    return [];
  }
}

function writePending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

function queueRecord(entry) {
  const list = readPending();
  list.push(entry);
  writePending(list);
}

async function flushPending() {
  const list = readPending();

  if (list.length === 0 || !navigator.onLine) {
    return 0;
  }

  const left = [];
  let sent = 0;

  for (const entry of list) {
    try {
      const result = await call({ mode: "record", code: entry.code, eventId: entry.eventId, value: entry.value });
      if (result.ok) {
        sent += 1;
      } else {
        // 코드가 바뀌었거나 종목이 사라진 경우다. 계속 붙들고 있어도 영영 안 들어간다.
        sent += 1;
      }
    } catch {
      left.push(entry);
    }
  }

  writePending(left);
  return sent;
}

function pendingNote() {
  const count = readPending().length;
  return count === 0 ? "" : ` · 저장 대기 ${count}건`;
}

// ── 최근 학생 ──
// 폰 한 대를 돌려쓰니 방금 잰 학생을 다시 부르는 일이 잦다. 코드를 또 치게 하지 않는다.

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function rememberRecent(code, student) {
  const list = readRecent().filter((item) => item.code !== code);
  list.unshift({ code, label: `${student.classNo} ${student.number}번`, name: student.name });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
}

function renderRecent() {
  const list = readRecent();
  elements.recentBox.hidden = list.length === 0;

  elements.recentList.replaceChildren(
    ...list.map((item) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      const label = document.createElement("span");
      const name = document.createElement("strong");

      button.type = "button";
      button.className = "queue-row";
      label.className = "row-label";
      label.textContent = item.label;
      name.textContent = item.name;

      button.append(label, name);
      button.addEventListener("click", () => submitCode(item.code));
      row.append(button);
      return row;
    })
  );
}

// ── 화면 ──

function currentEvent() {
  return state.events.find((event) => event.id === state.eventId) || null;
}

function fillEvents() {
  if (state.events.length === 0) {
    return;
  }

  if (!state.events.some((event) => event.id === state.eventId)) {
    state.eventId = state.events[0].id;
  }

  elements.eventSelect.replaceChildren(
    ...state.events.map((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = event.name;
      option.selected = event.id === state.eventId;
      return option;
    })
  );
}

function showStep(name) {
  elements.codeStep.hidden = name !== "code";
  elements.timerStep.hidden = name !== "timer";

  if (name === "code") {
    renderRecent();
    elements.codeInput.value = "";
    elements.codeInput.focus();
  }
}

function myRecords() {
  return state.records.filter((record) => record.eventId === state.eventId);
}

function bestOf(records, direction) {
  return records.reduce((best, record) => {
    if (best === null) {
      return record.value;
    }
    return direction === "lower" ? Math.min(best, record.value) : Math.max(best, record.value);
  }, null);
}

function renderAttempts() {
  const event = currentEvent();
  const records = myRecords();

  if (!event) {
    elements.attemptList.replaceChildren();
    return;
  }

  const best = bestOf(records, event.direction);

  elements.attemptCount.textContent =
    (records.length === 0 ? "아직 없음" : `${records.length}회 · 최고 ${formatValue(best, event.unit)}`) + pendingNote();

  elements.attemptList.replaceChildren(
    ...[...records].reverse().map((record, index) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      const remove = document.createElement("button");

      item.className = "attempt-row";
      label.className = "row-label";
      label.textContent = `${records.length - index}시기 · ${formatDate(record.recordedAt)}`;

      value.textContent = formatValue(record.value, event.unit);
      if (record.value === best) {
        value.classList.add("is-best");
      }

      remove.type = "button";
      remove.className = "text-button compact danger";
      remove.textContent = "삭제";
      remove.addEventListener("click", () => removeRecord(record.id));

      item.append(label, value, remove);
      return item;
    })
  );
}

function renderStudent() {
  const event = currentEvent();

  elements.studentName.textContent = state.student.name;
  elements.studentLabel.textContent = `${state.student.classNo} ${state.student.number}번 · ${event ? event.name : ""}`;

  const manual = Boolean(event) && event.unit !== "ms";
  elements.manualForm.hidden = !manual;
  elements.saveHint.hidden = manual;
  if (manual) {
    elements.manualValue.placeholder = `${UNIT_LABELS[event.unit]} 입력`;
    elements.manualValue.value = "";
  }

  renderAttempts();
}

// ── 동작 ──

function normalize(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function submitCode(rawCode) {
  const code = normalize(rawCode);

  if (code.length !== 6) {
    elements.codeHint.textContent = "코드는 6자리입니다.";
    elements.codeHint.classList.add("is-error");
    return;
  }

  elements.codeHint.classList.remove("is-error");
  elements.codeHint.textContent = "확인 중...";
  state.busy = true;

  try {
    const result = await call({ mode: "login", code });

    if (!result.found) {
      elements.codeHint.textContent = "그런 코드가 없습니다. 다시 확인해 주세요.";
      elements.codeHint.classList.add("is-error");
      return;
    }

    state.code = code;
    state.student = result.student;
    state.records = result.records;
    state.events = result.events;

    fillEvents();
    rememberRecent(code, result.student);
    timer.reset();
    renderStudent();
    showStep("timer");
    elements.codeHint.textContent = "";

    flushPending().then((sent) => {
      if (sent > 0) {
        renderAttempts();
      }
    });
  } catch (error) {
    elements.codeHint.textContent = `연결하지 못했습니다. ${error.message}`;
    elements.codeHint.classList.add("is-error");
  } finally {
    state.busy = false;
  }
}

async function saveValue(value) {
  const event = currentEvent();
  if (!event || !state.student) {
    return;
  }

  const entry = { code: state.code, eventId: state.eventId, value };

  try {
    const result = await call({ mode: "record", ...entry });

    if (result.ok) {
      state.records = result.records;
    } else {
      queueRecord(entry);
    }
  } catch {
    // 여기서 실패했다고 학생을 붙잡아 둘 수는 없다. 담아 두고 다음에 보낸다.
    queueRecord(entry);
  }

  renderAttempts();
}

async function removeRecord(recordId) {
  try {
    const result = await call({ mode: "unrecord", code: state.code, recordId });
    if (result.ok) {
      state.records = result.records;
      renderAttempts();
    }
  } catch {
    elements.attemptCount.textContent = "삭제하지 못했습니다. 잠시 후 다시 시도하세요.";
  }
}

function onStop(milliseconds) {
  const event = currentEvent();

  // 시간 종목이 아니면 부저로 잰 값에 의미가 없다. 숫자로 직접 넣는다.
  if (!event || event.unit !== "ms") {
    return;
  }

  saveValue(Math.round(milliseconds));
}

function onManualSubmit(submitEvent) {
  submitEvent.preventDefault();

  const event = currentEvent();
  if (!event) {
    return;
  }

  const value = parseValueInput(elements.manualValue.value, event.unit);
  if (value === null) {
    elements.manualValue.focus();
    return;
  }

  elements.manualValue.value = "";
  saveValue(value);
  elements.manualValue.focus();
}

// 부저는 Enter 로 들어온다. 코드를 치는 중에는 폼 제출이어야 한다.
function onKeyDown(event) {
  if (event.key !== "Enter" || elements.timerStep.hidden) {
    return;
  }

  if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)) {
    return;
  }

  event.preventDefault();
  timer.toggle({ resetOnStart: true });
}

// 눌렀던 버튼에 포커스가 남아 있으면 다음 부저 입력이 타이머가 아니라 그 버튼을 다시 누른다.
function releaseFocus(event) {
  if (event.detail === 0 || !(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("button");
  if (button) {
    button.blur();
  }
}

function init() {
  elements.codeStep = document.querySelector("#codeStep");
  elements.timerStep = document.querySelector("#timerStep");
  elements.eventSelect = document.querySelector("#eventSelect");
  elements.codeForm = document.querySelector("#codeForm");
  elements.codeInput = document.querySelector("#codeInput");
  elements.codeHint = document.querySelector("#codeHint");
  elements.recentBox = document.querySelector("#recentBox");
  elements.recentList = document.querySelector("#recentList");
  elements.clearRecent = document.querySelector("#clearRecent");
  elements.backButton = document.querySelector("#backButton");
  elements.nextButton = document.querySelector("#nextButton");
  elements.studentName = document.querySelector("#studentName");
  elements.studentLabel = document.querySelector("#studentLabel");
  elements.toggleButton = document.querySelector("#toggleButton");
  elements.saveHint = document.querySelector("#saveHint");
  elements.manualForm = document.querySelector("#manualForm");
  elements.manualValue = document.querySelector("#manualValue");
  elements.attemptList = document.querySelector("#attemptList");
  elements.attemptCount = document.querySelector("#attemptCount");

  timer = createTimer({
    display: document.querySelector("#timeDisplay"),
    panel: document.querySelector(".timer-panel"),
    badge: document.querySelector("#stateBadge"),
    hint: document.querySelector("#tapHint"),
    hints: {
      idle: "부저 또는 화면을 누르면 시작",
      running: "부저 또는 화면을 누르면 정지하고 저장",
      paused: "다시 누르면 한 번 더 잽니다",
    },
    onStop,
  });

  elements.codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCode(elements.codeInput.value);
  });

  // 소문자로 쳐도 되게 하고, 눈으로 확인하기 쉽게 대문자로 보여준다.
  elements.codeInput.addEventListener("input", () => {
    const cleaned = normalize(elements.codeInput.value).slice(0, 6);
    if (elements.codeInput.value !== cleaned) {
      elements.codeInput.value = cleaned;
    }
  });

  elements.eventSelect.addEventListener("change", () => {
    state.eventId = elements.eventSelect.value;
    localStorage.setItem(EVENT_KEY, state.eventId);
    if (state.student) {
      timer.reset();
      renderStudent();
    }
  });

  elements.clearRecent.addEventListener("click", () => {
    localStorage.removeItem(RECENT_KEY);
    renderRecent();
  });

  elements.backButton.addEventListener("click", () => showStep("code"));
  elements.nextButton.addEventListener("click", () => showStep("code"));
  elements.toggleButton.addEventListener("click", () => timer.toggle({ resetOnStart: true }));
  elements.manualForm.addEventListener("submit", onManualSubmit);

  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", releaseFocus);
  window.addEventListener("online", () => flushPending().then(renderAttempts));

  // 종목 목록은 로그인해야 받는다. 그 전에는 저장해 둔 선택만 기억해 둔다.
  showStep("code");
  flushPending();
}

init();
