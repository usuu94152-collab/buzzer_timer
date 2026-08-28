import { formatValue, formatDate } from "./format.js?v=21";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
const CHART_PADDING = 10;
const API_CACHE_KEY = "student.api";

const elements = {
  label: document.querySelector("#studentLabel"),
  message: document.querySelector("#studentMessage"),
  cards: document.querySelector("#studentCards"),
};

function readParameters() {
  const params = new URLSearchParams(location.search);
  const token = params.get("s") || "";
  const api = params.get("api") || localStorage.getItem(API_CACHE_KEY) || "";

  // 주소를 기억해 두면 다음부터 토큰만 있는 짧은 링크로도 열린다.
  if (params.get("api")) {
    localStorage.setItem(API_CACHE_KEY, params.get("api"));
  }

  return { token, api };
}

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function bestValue(records, direction) {
  return records.reduce((best, record) => {
    if (best === null) {
      return record.value;
    }
    return direction === "lower" ? Math.min(best, record.value) : Math.max(best, record.value);
  }, null);
}

function createSparkline(records, direction) {
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    class: "sparkline",
    role: "img",
    "aria-label": `기록 ${records.length}개의 변화`,
  });

  const values = records.map((record) => record.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = records.length > 1 ? (CHART_WIDTH - CHART_PADDING * 2) / (records.length - 1) : 0;
  const best = bestValue(records, direction);

  const points = records.map((record, index) => ({
    x: records.length > 1 ? CHART_PADDING + stepX * index : CHART_WIDTH / 2,
    y: CHART_HEIGHT - CHART_PADDING - ((record.value - min) / span) * (CHART_HEIGHT - CHART_PADDING * 2),
    record,
  }));

  if (points.length > 1) {
    svg.append(
      createSvgElement("polyline", {
        class: "sparkline-line",
        points: points.map((point) => `${point.x},${point.y}`).join(" "),
      })
    );
  }

  for (const point of points) {
    svg.append(
      createSvgElement("circle", {
        class: point.record.value === best ? "sparkline-dot is-best" : "sparkline-dot",
        cx: point.x,
        cy: point.y,
        r: point.record.value === best ? 4 : 3,
      })
    );
  }

  return svg;
}

function createStat(label, value) {
  const wrapper = document.createElement("div");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");

  labelElement.textContent = label;
  valueElement.textContent = value;
  wrapper.append(labelElement, valueElement);

  return wrapper;
}

function createEventCard(event, records) {
  const card = document.createElement("article");
  const header = document.createElement("div");
  const title = document.createElement("h3");
  const direction = document.createElement("span");
  const summary = document.createElement("div");
  const list = document.createElement("ol");

  card.className = "event-card";
  header.className = "section-title";
  title.textContent = event.name;
  direction.className = "row-label";
  direction.textContent = event.direction === "lower" ? "낮을수록 좋음" : "높을수록 좋음";
  header.append(title, direction);

  const best = bestValue(records, event.direction);
  const latest = records[records.length - 1];

  summary.className = "card-summary";
  summary.append(
    createStat("최고", formatValue(best, event.unit)),
    createStat("최근", formatValue(latest.value, event.unit)),
    createStat("횟수", `${records.length}회`)
  );

  list.className = "data-list compact-list";
  list.replaceChildren(
    ...[...records].reverse().map((record) => {
      const item = document.createElement("li");
      const date = document.createElement("span");
      const value = document.createElement("strong");

      date.className = "row-label";
      date.textContent = formatDate(record.recordedAt);
      value.textContent = formatValue(record.value, event.unit);
      item.append(date, value);

      return item;
    })
  );

  card.append(header, summary, createSparkline(records, event.direction), list);
  return card;
}

function renderPortfolio(payload) {
  elements.label.textContent = payload.label;

  const records = [...payload.records].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const cards = [];

  for (const [eventId, event] of Object.entries(payload.events)) {
    const eventRecords = records.filter((record) => record.eventId === eventId);
    if (eventRecords.length > 0) {
      cards.push(createEventCard(event, eventRecords));
    }
  }

  elements.cards.replaceChildren(...cards);
  elements.message.hidden = cards.length > 0;
  elements.message.textContent = "아직 기록이 없습니다.";
}

async function load() {
  const { token, api } = readParameters();

  if (!token || !api) {
    elements.message.textContent = "선생님께 받은 링크로 접속해 주세요.";
    return;
  }

  try {
    const response = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "portfolio", s: token }),
      redirect: "follow",
    });

    const payload = await response.json();

    if (!payload.found) {
      elements.message.textContent = "기록을 찾을 수 없습니다. 링크를 다시 확인해 주세요.";
      return;
    }

    renderPortfolio(payload);
  } catch {
    elements.message.textContent = "기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

load();
