import { listStudents, saveStudent, deleteStudent } from "./store.js?v=19";
import { getConfig, pushInBackground } from "./sync.js?v=19";

const elements = {};
let editingStudent = null;

function studentKey(classNo, number) {
  return `${classNo}/${number}`;
}

// 헤더 행이나 빈 줄은 번호가 숫자가 아니므로 자연스럽게 걸러진다.
function parseRoster(text) {
  const rows = [];

  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[\t,]/).map((cell) => cell.trim());
    if (cells.length < 3) {
      continue;
    }

    const [classNo, number, name] = cells;
    const parsedNumber = Number(number);
    if (!classNo || !name || number === "" || !Number.isFinite(parsedNumber)) {
      continue;
    }

    rows.push({ classNo, number: parsedNumber, name });
  }

  return rows;
}

function setEditing(student) {
  editingStudent = student;
  elements.classInput.value = student ? student.classNo : "";
  elements.numberInput.value = student ? student.number : "";
  elements.nameInput.value = student ? student.name : "";
  elements.submitButton.textContent = student ? "수정" : "추가";
  elements.cancelButton.hidden = !student;

  if (student) {
    elements.nameInput.focus();
  }
}

async function copyStudentLink(student) {
  const backendUrl = getConfig().url;

  if (!backendUrl) {
    elements.hint.textContent = "설정 탭에서 웹앱 주소를 먼저 입력해야 학생 링크를 만들 수 있습니다.";
    return;
  }

  // 웹앱 주소를 링크에 실어 보낸다. 공개 저장소에 주소를 커밋하지 않기 위해서다.
  const query = `s=${student.token}&api=${encodeURIComponent(backendUrl)}`;
  const link = new URL(`student.html?${query}`, location.href).href;

  try {
    await navigator.clipboard.writeText(link);
    elements.hint.textContent = `${student.name} 링크를 복사했습니다.`;
  } catch {
    // http 로 열면 clipboard 를 못 쓴다. 직접 복사하도록 보여준다.
    prompt(`${student.name} 조회 링크`, link);
  }
}

function createRow(student) {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const name = document.createElement("strong");
  const actions = document.createElement("span");
  const linkButton = document.createElement("button");
  const editButton = document.createElement("button");
  const removeButton = document.createElement("button");

  label.className = "row-label";
  label.textContent = `${student.classNo} ${student.number}번`;
  name.textContent = student.name;

  linkButton.type = "button";
  linkButton.className = "text-button compact";
  linkButton.textContent = "링크";
  linkButton.addEventListener("click", () => copyStudentLink(student));

  editButton.type = "button";
  editButton.className = "text-button compact";
  editButton.textContent = "수정";
  editButton.addEventListener("click", () => setEditing(student));

  removeButton.type = "button";
  removeButton.className = "text-button compact danger";
  removeButton.textContent = "삭제";
  removeButton.addEventListener("click", async () => {
    if (!confirm(`${student.classNo} ${student.number}번 ${student.name} 학생과 그 학생의 모든 기록을 삭제합니다.`)) {
      return;
    }
    await deleteStudent(student.id);
    if (editingStudent && editingStudent.id === student.id) {
      setEditing(null);
    }
    await render();
    pushInBackground();
  });

  actions.className = "row-actions";
  actions.append(linkButton, editButton, removeButton);
  item.append(label, name, actions);

  return item;
}

export async function render() {
  const students = await listStudents();

  elements.list.replaceChildren(...students.map(createRow));
  elements.count.textContent = `${students.length}명`;
  elements.empty.hidden = students.length > 0;
}

async function onSubmit(event) {
  event.preventDefault();

  const classNo = elements.classInput.value.trim();
  const number = Number(elements.numberInput.value);
  const name = elements.nameInput.value.trim();

  if (!classNo || !name || !Number.isFinite(number)) {
    return;
  }

  const students = await listStudents();
  const duplicate = students.find(
    (student) => studentKey(student.classNo, student.number) === studentKey(classNo, number)
  );

  if (duplicate && (!editingStudent || duplicate.id !== editingStudent.id)) {
    elements.hint.textContent = `${classNo} ${number}번은 이미 있습니다.`;
    return;
  }

  await saveStudent({ ...(editingStudent || {}), classNo, number, name });
  elements.hint.textContent = "";
  setEditing(null);
  elements.classInput.value = classNo;
  await render();
  // 명렬은 기기 안에만 있으면 기기가 바뀌는 순간 사라진다. 기록과 똑같이 바로 올린다.
  pushInBackground();
}

async function onImport() {
  const rows = parseRoster(elements.importText.value);

  if (rows.length === 0) {
    elements.importHint.textContent = "읽을 수 있는 줄이 없습니다. 반,번호,이름 순서인지 확인해 주세요.";
    return;
  }

  const existing = await listStudents();
  const byKey = new Map(existing.map((student) => [studentKey(student.classNo, student.number), student]));
  let added = 0;
  let updated = 0;

  for (const row of rows) {
    const found = byKey.get(studentKey(row.classNo, row.number));
    // 같은 반·번호면 기존 학생을 갱신한다. 새로 만들면 그 학생의 기록이 끊긴다.
    await saveStudent(found ? { ...found, name: row.name } : row);
    if (found) {
      updated += 1;
    } else {
      added += 1;
    }
  }

  elements.importText.value = "";
  elements.importHint.textContent = `${added}명 추가, ${updated}명 갱신했습니다.`;
  await render();
  pushInBackground();
}

export function initRoster() {
  elements.form = document.querySelector("#studentForm");
  elements.classInput = document.querySelector("#studentClass");
  elements.numberInput = document.querySelector("#studentNumber");
  elements.nameInput = document.querySelector("#studentName");
  elements.submitButton = document.querySelector("#studentSubmit");
  elements.cancelButton = document.querySelector("#studentCancel");
  elements.hint = document.querySelector("#studentHint");
  elements.list = document.querySelector("#studentList");
  elements.count = document.querySelector("#studentCount");
  elements.empty = document.querySelector("#studentEmpty");
  elements.importToggle = document.querySelector("#importToggle");
  elements.importBox = document.querySelector("#importBox");
  elements.importText = document.querySelector("#importText");
  elements.importButton = document.querySelector("#importButton");
  elements.importHint = document.querySelector("#importHint");

  elements.form.addEventListener("submit", onSubmit);
  elements.cancelButton.addEventListener("click", () => {
    elements.hint.textContent = "";
    setEditing(null);
  });
  elements.importToggle.addEventListener("click", () => {
    elements.importBox.hidden = !elements.importBox.hidden;
  });
  elements.importButton.addEventListener("click", onImport);
}
