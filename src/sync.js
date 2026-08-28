import { listUnsynced, markSynced, listDeletions, clearDeletions, replaceRoster } from "./store.js?v=19";

const URL_KEY = "sync.url";
const KEY_KEY = "sync.key";

export function getConfig() {
  return {
    url: localStorage.getItem(URL_KEY) || "",
    key: localStorage.getItem(KEY_KEY) || "",
  };
}

export function setConfig({ url, key }) {
  localStorage.setItem(URL_KEY, url.trim());
  localStorage.setItem(KEY_KEY, key.trim());
}

export function isConfigured() {
  const config = getConfig();
  return Boolean(config.url && config.key);
}

async function callBackend(payload) {
  const config = getConfig();

  // Content-Type 이 application/json 이면 CORS preflight(OPTIONS)가 발생하는데
  // Apps Script 웹앱은 OPTIONS 에 응답하지 못한다. text/plain 이면 preflight 가 없다.
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, key: config.key }),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`서버가 ${response.status} 로 응답했습니다.`);
  }

  const result = await response.json();

  if (result.error === "unauthorized") {
    throw new Error("API 키가 맞지 않습니다.");
  }
  if (result.error) {
    throw new Error(`서버 오류: ${result.error}`);
  }

  return result;
}

export async function countPending() {
  const pending = await listUnsynced();
  const deletions = listDeletions();

  return (
    pending.students.length +
    pending.events.length +
    pending.records.length +
    deletions.students.length +
    deletions.events.length +
    deletions.records.length
  );
}

export async function push() {
  if (!isConfigured()) {
    throw new Error("설정 탭에서 웹앱 주소와 API 키를 먼저 입력하세요.");
  }

  const pending = await listUnsynced();
  const deletions = listDeletions();

  if ((await countPending()) === 0) {
    return { pushed: 0 };
  }

  await callBackend({ ...pending, delete: deletions });
  await markSynced(pending);
  clearDeletions();

  return { pushed: pending.students.length + pending.events.length + pending.records.length };
}

export async function pullRoster() {
  if (!isConfigured()) {
    throw new Error("설정 탭에서 웹앱 주소와 API 키를 먼저 입력하세요.");
  }

  const roster = await callBackend({ mode: "roster" });
  await replaceRoster(roster);

  return { students: roster.students.length, events: roster.events.length };
}

// 측정 중에는 실패해도 조용히 넘어간다. 운동장에서 네트워크가 끊겨도 측정이 멈추면 안 된다.
export function pushInBackground() {
  if (!isConfigured() || !navigator.onLine) {
    return;
  }

  push().catch(() => {});
}

export function initSync() {
  window.addEventListener("online", pushInBackground);
}
