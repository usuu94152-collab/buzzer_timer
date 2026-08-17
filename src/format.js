export const UNIT_LABELS = {
  ms: "시간",
  count: "회",
  cm: "cm",
};

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatElapsed(milliseconds) {
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

export function formatValue(value, unit) {
  if (unit === "ms") {
    return formatElapsed(value);
  }

  if (unit === "count") {
    return `${value}회`;
  }

  return `${value}cm`;
}

// 시간 종목은 "1:23.45", "83.45", "83" 을 모두 밀리초로 받는다.
export function parseValueInput(text, unit) {
  const trimmed = String(text).trim();
  if (!trimmed) {
    return null;
  }

  if (unit !== "ms") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  const [minutePart, secondPart] = trimmed.includes(":") ? trimmed.split(":") : ["0", trimmed];
  const minutes = Number(minutePart);
  const seconds = Number(secondPart);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0) {
    return null;
  }

  return Math.round((minutes * 60 + seconds) * 1000);
}

export function formatDate(isoString) {
  const date = new Date(isoString);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export function studentLabel(student) {
  return `${student.classNo} ${student.number}번`;
}
