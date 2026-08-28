import { formatElapsed } from "./src/format.js?v=21";
import { initRoster, render as renderRoster } from "./src/roster.js?v=21";
import { initMeasure, render as renderMeasure, canRecordElapsed, isMeasureActive, isTimerStep, recordElapsed } from "./src/measure.js?v=21";
import { initPortfolio, render as renderPortfolio } from "./src/portfolio.js?v=21";
import { initSettings, render as renderSettings } from "./src/settings.js?v=21";
import { initSync } from "./src/sync.js?v=21";

const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"];

const elements = {
  panel: document.querySelector(".timer-panel"),
  timeDisplay: document.querySelector("#timeDisplay"),
  stateBadge: document.querySelector("#stateBadge"),
  tapHint: document.querySelector("#tapHint"),
  toggleButton: document.querySelector("#toggleButton"),
  resetButton: document.querySelector("#resetButton"),
  copyButton: document.querySelector("#copyButton"),
  soundButton: document.querySelector("#soundButton"),
  lastTime: document.querySelector("#lastTime"),
  stopCount: document.querySelector("#stopCount"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  tabButtons: document.querySelectorAll("[data-tab-target]"),
  tabViews: document.querySelectorAll("[data-tab-view]"),
};

const state = {
  running: false,
  startedAt: 0,
  elapsedBeforeStart: 0,
  lastToggleAt: 0,
  lastRenderedText: "",
  soundEnabled: true,
  history: [],
  rafId: 0,
  audioContext: null,
  activeTab: "timer",
};

const DIGIT_SEGMENTS = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "g", "e", "d"],
  3: ["a", "b", "c", "d", "g"],
  4: ["f", "g", "b", "c"],
  5: ["a", "f", "g", "c", "d"],
  6: ["a", "f", "e", "d", "c", "g"],
  7: ["a", "b", "c"],
  8: ["a", "b", "c", "d", "e", "f", "g"],
  9: ["a", "b", "c", "d", "f", "g"],
};

function now() {
  return performance.now();
}

function currentElapsed() {
  if (!state.running) {
    return state.elapsedBeforeStart;
  }
  return state.elapsedBeforeStart + now() - state.startedAt;
}

function updateDisplay() {
  const elapsed = currentElapsed();
  const formatted = formatElapsed(elapsed);

  if (formatted !== state.lastRenderedText) {
    renderLedDisplay(formatted);
    state.lastRenderedText = formatted;
  }

  if (state.running) {
    state.rafId = requestAnimationFrame(updateDisplay);
  }
}

function renderLedDisplay(value) {
  const fragment = document.createDocumentFragment();

  for (const character of value) {
    if (/\d/.test(character)) {
      fragment.append(createLedDigit(character));
      continue;
    }

    if (character === ":") {
      fragment.append(createSeparator("colon"));
      continue;
    }

    if (character === ".") {
      fragment.append(createSeparator("dot"));
    }
  }

  elements.timeDisplay.replaceChildren(fragment);
  elements.timeDisplay.setAttribute("aria-label", value);
}

function createLedDigit(character) {
  const digit = document.createElement("span");
  const activeSegments = new Set(DIGIT_SEGMENTS[character]);
  digit.className = "led-digit";
  digit.setAttribute("aria-hidden", "true");

  for (const segmentName of ["a", "b", "c", "d", "e", "f", "g"]) {
    const segment = document.createElement("span");
    segment.className = `segment ${segmentName}${activeSegments.has(segmentName) ? " is-on" : ""}`;
    digit.append(segment);
  }

  return digit;
}

function createSeparator(type) {
  const separator = document.createElement("span");
  separator.className = `led-separator ${type}`;
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function setMode(mode) {
  elements.panel.dataset.state = mode;

  if (mode === "running") {
    elements.stateBadge.textContent = "진행";
    elements.tapHint.textContent = "부저 또는 화면을 누르면 정지";
    return;
  }

  if (mode === "paused") {
    elements.stateBadge.textContent = "정지";
    elements.tapHint.textContent = "부저 또는 화면을 누르면 재시작";
    return;
  }

  elements.stateBadge.textContent = "대기";
  elements.tapHint.textContent = "부저 또는 화면을 누르면 시작";
}

function toggleTimer(inputSource = "button") {
  const pressedAt = now();
  if (pressedAt - state.lastToggleAt < 220) {
    return;
  }
  state.lastToggleAt = pressedAt;

  ensureAudio();

  if (state.running) {
    state.elapsedBeforeStart = currentElapsed();
    state.running = false;
    cancelAnimationFrame(state.rafId);
    addHistory(state.elapsedBeforeStart);
    setMode("paused");
    playTone(220, 0.08);

    if (canRecordElapsed()) {
      recordElapsed(state.elapsedBeforeStart);
    }
  } else {
    // 측정 모드에서는 학생마다 0 에서 다시 재는 것이지, 직전 기록을 이어가는 게 아니다.
    if (isMeasureActive()) {
      state.elapsedBeforeStart = 0;
    }
    state.startedAt = now();
    state.running = true;
    setMode("running");
    playTone(660, 0.06);
    state.rafId = requestAnimationFrame(updateDisplay);
  }

  updateDisplay();
  elements.toggleButton.dataset.lastInput = inputSource;
}

function resetTimer() {
  state.running = false;
  state.startedAt = 0;
  state.elapsedBeforeStart = 0;
  cancelAnimationFrame(state.rafId);
  setMode("idle");
  updateDisplay();
}

async function showTab(name) {
  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === name;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  elements.tabViews.forEach((view) => {
    const isActive = view.dataset.tabView === name;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });

  state.activeTab = name;

  if (name === "roster") {
    await renderRoster();
    return;
  }

  if (name === "records") {
    await renderPortfolio();
    return;
  }

  // 설정 탭의 종목 목록도 measure 모듈이 그린다.
  await renderMeasure();

  if (name === "settings") {
    await renderSettings();
  }
}

async function copyTime() {
  const value = formatElapsed(currentElapsed());
  try {
    await navigator.clipboard.writeText(value);
    elements.tapHint.textContent = `${value} 복사됨`;
  } catch {
    elements.tapHint.textContent = value;
  }
}

function addHistory(milliseconds) {
  const entry = formatElapsed(milliseconds);
  state.history.unshift(entry);
  state.history = state.history.slice(0, 8);
  renderHistory();
}

function clearHistory() {
  state.history = [];
  renderHistory();
}

function renderHistory() {
  elements.historyList.textContent = "";

  state.history.forEach((entry, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const time = document.createElement("strong");

    number.textContent = `#${state.history.length - index}`;
    time.textContent = entry;
    item.append(number, time);
    elements.historyList.append(item);
  });

  elements.lastTime.textContent = state.history[0] || "없음";
  elements.stopCount.textContent = `${state.history.length}회`;
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  elements.soundButton.classList.toggle("is-active", state.soundEnabled);
  elements.soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
  elements.soundButton.textContent = state.soundEnabled ? "켜짐" : "꺼짐";
}

function ensureAudio() {
  if (!state.soundEnabled || state.audioContext) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  state.audioContext = new AudioContextClass();
}

function playTone(frequency, durationSeconds) {
  if (!state.soundEnabled || !state.audioContext) {
    return;
  }

  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();
  const start = state.audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.16, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);

  oscillator.connect(gain);
  gain.connect(state.audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + durationSeconds + 0.02);
}

// 명렬 입력 중 Enter 는 폼 제출이어야 한다. 부저는 타이머 화면에서만 받는다.
// 학생을 고르는 목록 단계에서도 막는다. 그러지 않으면 안 보이는 타이머가 돌아간다.
function onKeyDown(event) {
  if (event.key !== "Enter" || state.activeTab !== "timer" || !isTimerStep()) {
    return;
  }

  if (event.target instanceof HTMLElement && TYPING_TAGS.includes(event.target.tagName)) {
    return;
  }

  event.preventDefault();
  toggleTimer("enter");
}

// 입력칸에서 Enter 로 제출하는 동작을 브라우저 기본 동작에 맡기지 않는다.
// 이 앱의 주 입력이 Enter 라 확실하게 한 번만 제출되어야 한다.
// preventDefault 로 암묵적 제출을 막고 requestSubmit 으로 직접 보낸다.
function submitFormOnEnter(event) {
  if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) {
    return;
  }

  const form = event.target.form;
  if (!form) {
    return;
  }

  event.preventDefault();
  form.requestSubmit();
}

// 부저는 Enter 로 들어온다. 눌렀던 버튼에 포커스가 남아 있으면
// 다음 부저 입력이 타이머가 아니라 그 버튼을 다시 누른다.
// detail 이 0 이면 키보드로 활성화한 것이므로 포커스를 건드리지 않는다.
function releaseFocusAfterPointerClick(event) {
  if (event.detail === 0 || !(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("button");
  if (button) {
    button.blur();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

elements.toggleButton.addEventListener("click", () => toggleTimer("touch"));
elements.resetButton.addEventListener("click", resetTimer);
elements.copyButton.addEventListener("click", copyTime);
elements.soundButton.addEventListener("click", toggleSound);
elements.clearHistoryButton.addEventListener("click", clearHistory);
elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tabTarget));
});
window.addEventListener("keydown", onKeyDown);
document.addEventListener("keydown", submitFormOnEnter);
document.addEventListener("click", releaseFocusAfterPointerClick);

initRoster();
// 다른 학생을 고르면 앞 학생의 시간이 남아 있으면 안 된다.
initMeasure({ onStudentChange: resetTimer });
initPortfolio();
initSettings();
initSync();

setMode("idle");
renderHistory();
updateDisplay();
showTab("timer");
registerServiceWorker();
