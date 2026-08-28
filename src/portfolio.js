import { listStudents, listEvents, listRecords, deleteRecord, bestValue, isBetter } from "./store.js?v=20";
import { formatValue, formatDate } from "./format.js?v=20";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
const CHART_PADDING = 10;

const elements = {};

const state = {
  classNo: "",
  studentId: "",
  students: [],
  events: [],
};

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
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

function createRecordRow(record, event, onChange) {
  const item = document.createElement("li");
  const date = document.createElement("span");
  const value = document.createElement("strong");
  const removeButton = document.createElement("button");

  date.className = "row-label";
  date.textContent = formatDate(record.recordedAt);
  value.textContent = formatValue(record.value, event.unit);

  removeButton.type = "button";
  removeButton.className = "text-button compact danger";
  removeButton.textContent = "삭제";
  removeButton.addEventListener("click", async () => {
    await deleteRecord(record.id);
    await onChange();
  });

  item.append(date, value, removeButton);
  return item;
}

function createEventCard(event, records, onChange) {
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
  const previous = records.length > 1 ? records[records.length - 2] : null;

  summary.className = "card-summary";
  summary.append(
    createStat("최고", formatValue(best, event.unit)),
    createStat("최근", formatValue(latest.value, event.unit)),
    createStat("횟수", `${records.length}회`)
  );

  if (previous && isBetter(latest.value, previous.value, event.direction)) {
    const badge = document.createElement("span");
    badge.className = "improve-badge";
    badge.textContent = latest.value === best ? "개인 최고 기록" : "직전보다 향상";
    summary.append(badge);
  }

  list.className = "data-list compact-list";
  list.replaceChildren(...[...records].reverse().map((record) => createRecordRow(record, event, onChange)));

  card.append(header, summary, createSparkline(records, event.direction), list);
  return card;
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

export async function render() {
  const allStudents = await listStudents();
  const classes = [...new Set(allStudents.map((student) => student.classNo))];

  if (!classes.includes(state.classNo)) {
    state.classNo = classes[0] || "";
  }

  state.students = allStudents.filter((student) => student.classNo === state.classNo);
  state.events = await listEvents();

  if (!state.students.some((student) => student.id === state.studentId)) {
    state.studentId = state.students[0]?.id || "";
  }

  fillSelect(
    elements.classSelect,
    classes.map((classNo) => ({ value: classNo, label: classNo })),
    state.classNo,
    "반 없음"
  );
  fillSelect(
    elements.studentSelect,
    state.students.map((student) => ({ value: student.id, label: `${student.number}번 ${student.name}` })),
    state.studentId,
    "학생 없음"
  );

  await renderDetail();
}

async function renderDetail() {
  const student = state.students.find((item) => item.id === state.studentId);

  if (!student) {
    elements.cards.replaceChildren();
    elements.empty.hidden = false;
    elements.empty.textContent = "명렬 탭에서 학생을 먼저 등록하세요.";
    return;
  }

  const records = await listRecords({ studentId: student.id });
  const cards = [];

  for (const event of state.events) {
    const eventRecords = records.filter((record) => record.eventId === event.id);
    if (eventRecords.length > 0) {
      cards.push(createEventCard(event, eventRecords, renderDetail));
    }
  }

  elements.cards.replaceChildren(...cards);
  elements.empty.hidden = cards.length > 0;
  elements.empty.textContent = "아직 기록이 없습니다.";
}

async function exportCsv() {
  const students = await listStudents();
  const events = await listEvents();
  const records = await listRecords();
  const eventById = new Map(events.map((event) => [event.id, event]));
  const studentById = new Map(students.map((student) => [student.id, student]));

  const header = ["반", "번호", "이름", "종목", "기록", "원본값", "단위", "측정일시"];
  const rows = records.map((record) => {
    const student = studentById.get(record.studentId);
    const event = eventById.get(record.eventId);
    return [
      student?.classNo ?? "",
      student?.number ?? "",
      student?.name ?? "",
      event?.name ?? "",
      event ? formatValue(record.value, event.unit) : record.value,
      record.value,
      event?.unit ?? "",
      record.recordedAt,
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  // 엑셀이 한글을 깨뜨리지 않도록 BOM 을 붙인다.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `기록_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  // 즉시 해제하면 브라우저가 내려받기를 시작하기 전에 URL 이 사라질 수 있다.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function initPortfolio() {
  elements.classSelect = document.querySelector("#portfolioClass");
  elements.studentSelect = document.querySelector("#portfolioStudent");
  elements.cards = document.querySelector("#portfolioCards");
  elements.empty = document.querySelector("#portfolioEmpty");
  elements.exportButton = document.querySelector("#exportCsv");

  elements.classSelect.addEventListener("change", async () => {
    state.classNo = elements.classSelect.value;
    state.studentId = "";
    await render();
  });

  elements.studentSelect.addEventListener("change", async () => {
    state.studentId = elements.studentSelect.value;
    await renderDetail();
  });

  elements.exportButton.addEventListener("click", exportCsv);
}
