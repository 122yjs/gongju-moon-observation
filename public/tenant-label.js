(() => {
  "use strict";

  function replaceLabels(label) {
    const header = Array.from(document.querySelectorAll("header p")).find((element) =>
      element.textContent && element.textContent.includes("공주시 기준"),
    );
    if (header) header.textContent = `📍 공주시 기준 · ${label}`;

    document.querySelectorAll("strong, span").forEach((element) => {
      if (element.textContent?.trim() === "4학년 1반") element.textContent = label;
    });
  }

  async function refreshLabel() {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
      const result = await response.json();
      if (!result.authenticated || !result.classLabel) return;
      replaceLabels(result.classLabel);
      const observer = new MutationObserver(() => replaceLabels(result.classLabel));
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      // 달 정보 화면은 세션 API가 실패해도 그대로 사용할 수 있습니다.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshLabel, { once: true });
  } else {
    void refreshLabel();
  }
})();
