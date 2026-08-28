import { getConfig, setConfig, isConfigured, push, pullRoster, countPending } from "./sync.js?v=19";

const elements = {};

function setHint(message, isError = false) {
  elements.hint.textContent = message;
  elements.hint.classList.toggle("is-error", isError);
}

export async function render() {
  const config = getConfig();

  elements.url.value = config.url;
  elements.key.value = config.key;

  if (!isConfigured()) {
    elements.pending.textContent = "연동 안 됨";
    return;
  }

  elements.pending.textContent = `보낼 항목 ${await countPending()}건`;
}

async function runAction(button, action) {
  button.disabled = true;
  setHint("처리 중...");

  try {
    setHint(await action());
  } catch (error) {
    setHint(error.message, true);
  } finally {
    button.disabled = false;
    await render();
  }
}

export function initSettings() {
  elements.form = document.querySelector("#syncForm");
  elements.url = document.querySelector("#syncUrl");
  elements.key = document.querySelector("#syncKey");
  elements.pending = document.querySelector("#syncPending");
  elements.hint = document.querySelector("#syncHint");
  elements.pushButton = document.querySelector("#syncPush");
  elements.pullButton = document.querySelector("#syncPull");

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setConfig({ url: elements.url.value, key: elements.key.value });
    setHint("저장했습니다.");
    await render();
  });

  elements.pushButton.addEventListener("click", () =>
    runAction(elements.pushButton, async () => {
      const result = await push();
      return result.pushed === 0 ? "보낼 항목이 없습니다." : `${result.pushed}건 보냈습니다.`;
    })
  );

  elements.pullButton.addEventListener("click", () =>
    runAction(elements.pullButton, async () => {
      if (!confirm("시트의 명렬과 종목을 이 기기로 덮어씁니다. 계속할까요?")) {
        return "취소했습니다.";
      }
      const result = await pullRoster();
      return `학생 ${result.students}명, 종목 ${result.events}개를 가져왔습니다.`;
    })
  );
}
