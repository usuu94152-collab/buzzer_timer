import { formatElapsed } from "./format.js?v=20";

// 7세그먼트 숫자. 어느 획을 켜는지만 적어 두고 나머지는 꺼진 채로 남긴다.
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

const SEGMENT_NAMES = ["a", "b", "c", "d", "e", "f", "g"];

// 부저는 접점이 튀어 한 번 눌러도 두 번 들어오는 일이 있다.
const DEBOUNCE_MS = 220;

function createLedDigit() {
  const digit = document.createElement("span");
  digit.className = "led-digit";
  digit.setAttribute("aria-hidden", "true");

  const segments = {};
  for (const name of SEGMENT_NAMES) {
    const segment = document.createElement("span");
    segment.className = `segment ${name}`;
    digit.append(segment);
    segments[name] = segment;
  }

  return { element: digit, segments };
}

function createSeparator(type) {
  const separator = document.createElement("span");
  separator.className = `led-separator ${type}`;
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

/**
 * 자리마다 span 을 한 번만 만들고 클래스만 켜고 끈다.
 * 1/100 초마다 통째로 다시 만들면 초당 5천 개씩 노드를 새로 찍게 되어
 * 운동장에서 쓰는 보급형 기기가 눈에 띄게 버벅인다.
 */
function createDisplay(root) {
  let shape = "";
  let digits = [];

  function rebuild(value) {
    const fragment = document.createDocumentFragment();
    digits = [];

    for (const character of value) {
      if (/\d/.test(character)) {
        const digit = createLedDigit();
        digits.push(digit);
        fragment.append(digit.element);
        continue;
      }

      if (character === ":" || character === ".") {
        fragment.append(createSeparator(character === ":" ? "colon" : "dot"));
      }
    }

    root.replaceChildren(fragment);
    shape = value.replace(/\d/g, "#");
  }

  return function render(value) {
    // 자릿수가 바뀔 때만 다시 만든다. 그 외에는 획만 갈아 끼운다.
    if (value.replace(/\d/g, "#") !== shape) {
      rebuild(value);
    }

    let index = 0;
    for (const character of value) {
      if (!/\d/.test(character)) {
        continue;
      }

      const on = new Set(DIGIT_SEGMENTS[character]);
      const digit = digits[index];
      for (const name of SEGMENT_NAMES) {
        digit.segments[name].classList.toggle("is-on", on.has(name));
      }
      index += 1;
    }

    root.setAttribute("aria-label", value);
  };
}

function createBeeper() {
  let context = null;
  let enabled = true;

  return {
    setEnabled(value) {
      enabled = value;
    },
    isEnabled() {
      return enabled;
    },
    // 오디오는 사용자가 화면을 건드린 뒤에야 만들 수 있다. 누를 때마다 확인한다.
    ensure() {
      if (!enabled || context) {
        return;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        context = new AudioContextClass();
      }
    },
    play(frequency, durationSeconds) {
      if (!enabled || !context) {
        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + durationSeconds + 0.02);
    },
  };
}

/**
 * 화면과 소리를 묶은 스톱워치.
 * 무엇을 잰 것인지(학생인지 그냥 시간인지)는 부르는 쪽이 알아서 하고,
 * 여기서는 시간과 표시만 책임진다.
 */
export function createTimer({ display, panel, badge, hint, hints = {}, onStop }) {
  const render = createDisplay(display);
  const beeper = createBeeper();

  const text = {
    idle: hints.idle || "부저 또는 화면을 누르면 시작",
    running: hints.running || "부저 또는 화면을 누르면 정지",
    paused: hints.paused || "부저 또는 화면을 누르면 재시작",
  };

  const state = {
    running: false,
    startedAt: 0,
    elapsedBeforeStart: 0,
    lastToggleAt: 0,
    lastText: "",
    rafId: 0,
  };

  function now() {
    return performance.now();
  }

  function elapsed() {
    return state.running ? state.elapsedBeforeStart + now() - state.startedAt : state.elapsedBeforeStart;
  }

  function paint() {
    const value = formatElapsed(elapsed());

    if (value !== state.lastText) {
      render(value);
      state.lastText = value;
    }

    if (state.running) {
      state.rafId = requestAnimationFrame(paint);
    }
  }

  function setMode(mode) {
    if (panel) {
      panel.dataset.state = mode;
    }
    if (badge) {
      badge.textContent = mode === "running" ? "진행" : mode === "paused" ? "정지" : "대기";
    }
    if (hint) {
      hint.textContent = text[mode] || text.idle;
    }
  }

  function reset() {
    state.running = false;
    state.startedAt = 0;
    state.elapsedBeforeStart = 0;
    cancelAnimationFrame(state.rafId);
    setMode("idle");
    paint();
  }

  function toggle(options = {}) {
    const pressedAt = now();
    if (pressedAt - state.lastToggleAt < DEBOUNCE_MS) {
      return;
    }
    state.lastToggleAt = pressedAt;

    beeper.ensure();

    if (state.running) {
      state.elapsedBeforeStart = elapsed();
      state.running = false;
      cancelAnimationFrame(state.rafId);
      setMode("paused");
      beeper.play(220, 0.08);
      if (onStop) {
        onStop(state.elapsedBeforeStart);
      }
    } else {
      // 시기마다 0 에서 다시 재는 화면이면 직전 기록을 이어가면 안 된다.
      if (options.resetOnStart) {
        state.elapsedBeforeStart = 0;
      }
      state.startedAt = now();
      state.running = true;
      setMode("running");
      beeper.play(660, 0.06);
      state.rafId = requestAnimationFrame(paint);
    }

    paint();
  }

  setMode("idle");
  paint();

  return {
    toggle,
    reset,
    elapsed,
    isRunning: () => state.running,
    setSoundEnabled: (value) => beeper.setEnabled(value),
    isSoundEnabled: () => beeper.isEnabled(),
  };
}
