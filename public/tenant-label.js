(() => {
  "use strict";

  function normalizedLabel(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function replaceLabels(result) {
    const classLabel = normalizedLabel(result.classLabel, "우리 반");
    const regionLabel = normalizedLabel(result.regionLabel, "관찰 지역");
    const regionShortLabel = normalizedLabel(result.regionShortLabel, "지역");
    const title = `${regionShortLabel} 달 관찰 탐험대`;
    const appTitle = document.getElementById("studentAppTitle");
    const header = document.getElementById("studentClassHeaderLabel");
    const submitLabel = document.getElementById("submitClassLabel");
    const calendarLabel = document.getElementById("moonCalendarLabel");
    const footerBrand = document.getElementById("footerBrand");
    document.title = title;
    if (appTitle) appTitle.textContent = title;
    if (header) header.textContent = `📍 ${regionLabel} 기준 · ${classLabel}`;
    if (submitLabel) submitLabel.textContent = classLabel;
    if (calendarLabel) calendarLabel.textContent = `${regionShortLabel} 하늘 달력`;
    if (footerBrand) footerBrand.textContent = title;
  }

  async function refreshLabel() {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
      const result = await response.json();
      if (!result.authenticated || !result.classLabel) return;
      replaceLabels(result);
      const observer = new MutationObserver(() => replaceLabels(result));
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
