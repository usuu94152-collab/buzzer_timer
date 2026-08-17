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

function formatElapsed(milliseconds) {
  const totalCentiseconds = Math.floor(milliseconds / 10);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
  }

  return `${pad(totalMinutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
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
  } else {
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

function showTab(name) {
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

function onKeyDown(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  toggleTimer("enter");
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

showTab("timer");
setMode("idle");
renderHistory();
updateDisplay();
registerServiceWorker();
