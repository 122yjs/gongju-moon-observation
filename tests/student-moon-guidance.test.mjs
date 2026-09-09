import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function classList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function loadStudentPage(overrides = {}) {
  const elements = new Map();
  const events = new Map();
  const storage = new Map();
  const permissionCalls = { count: 0 };
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        textContent: "",
        innerHTML: "",
        className: "",
        disabled: false,
        dataset: {},
        attributes: {},
        classList: classList(),
        addEventListener: (name, fn) => events.set(`${id}:${name}`, fn),
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        getAttribute(name) {
          return this.attributes[name] ?? null;
        },
        removeAttribute(name) {
          delete this.attributes[name];
        },
        focus() {
          this.focused = true;
        },
      });
    }
    return elements.get(id);
  };

  const context = {
    Blob,
    Date,
    FormData,
    Intl,
    JSON,
    Math,
    Promise,
    console,
    crypto,
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      body: { classList: classList() },
      activeElement: null,
      visibilityState: "visible",
      addEventListener: (name, fn) => events.set(name, fn),
      getElementById: element,
      querySelectorAll: () => [],
    },
    fetch: async () => ({ ok: true, json: async () => ({ authenticated: true, draftScope: "class-a" }) }),
    scrollTo() {},
    DeviceOrientationEvent: class {
      static requestPermission() {
        permissionCalls.count += 1;
        return Promise.resolve("granted");
      }
    },
    ...overrides,
  };
  context.window = context;
  ["lateNightDialog", "compassPanel", "observationGuidanceDetail", "observationGuidanceNext", "compassStatus"].forEach(
    (id) => element(id).classList.add("hidden"),
  );

  runInNewContext(
    `${script}
hasClassSession = true;
globalThis.api = {
  MoonEngine, showView, openCompass, closeCompass, maybeShowLateNightDialog,
  restFromLateNight, stayFromLateNight, renderToday, renderSubmitObservationSupport,
  setSelectedDate(date) { selectedDate = date; },
};
`,
    context,
  );
  return { context, element, events, storage, permissionCalls, api: context.api };
}

test("shows easy moon-time names next to textbook terms", () => {
  assert.match(html, /달이 뜨는 때/);
  assert.match(html, />월출</);
  assert.match(html, /가장 높을 때/);
  assert.match(html, />남중</);
  assert.match(html, /달이 지는 때/);
  assert.match(html, />월몰</);
  assert.match(html, /달의 나이/);
  assert.match(html, /월령/);
  assert.match(html, /밝은 정도/);
  assert.match(html, /밝기/);
  assert.match(html, /id="moonriseDirection"/);
  assert.match(html, /id="observationGuidanceCard"/);
  assert.match(html, /나침반 열기/);
  assert.match(html, /지금은 너무 늦었어요/);
  assert.match(html, /오늘은 푹 쉬고, 내일 달을 관찰해요/);
  assert.match(html, /오늘은 쉬기/);
  assert.match(html, /이미 찍은 사진 올리기/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /기기 센서에 따라 방향이 조금 다를 수 있어요/);
  assert.match(html, /오늘은 달을 관찰하기 어려운 날이에요/);
  assert.match(html, /id="observationTipCard"/);
  assert.doesNotMatch(html, /안 보여요/);
});

test("converts moon azimuths into the four student directions", () => {
  const { api } = loadStudentPage();
  assert.equal(api.MoonEngine.compassDegreesToCardinal(0), "북쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(44.9), "북쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(45), "동쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(134.9), "동쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(135), "남쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(224.9), "남쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(225), "서쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(314.9), "서쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(315), "북쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(api.MoonEngine.azimuthToCompassDegrees(0)), "남쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(api.MoonEngine.azimuthToCompassDegrees(Math.PI / 2)), "서쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(api.MoonEngine.azimuthToCompassDegrees(Math.PI)), "북쪽");
  assert.equal(api.MoonEngine.compassDegreesToCardinal(api.MoonEngine.azimuthToCompassDegrees(-Math.PI / 2)), "동쪽");
});

test("observation guidance prefers daylight, then moon below, then a dark moon", () => {
  const { api } = loadStudentPage();
  const daylight = api.MoonEngine.decideObservationGuidance({
    sunAltitudeDeg: 10,
    moonAltitudeDeg: 20,
    illuminationFraction: 0.8,
  });
  assert.equal(daylight.kind, "daylight");
  assert.equal(daylight.title, "햇빛이 밝아 달을 찾기 어려울 수 있어요");

  const below = api.MoonEngine.decideObservationGuidance({
    sunAltitudeDeg: -20,
    moonAltitudeDeg: -5,
    illuminationFraction: 0.8,
  });
  assert.equal(below.kind, "moon-below");
  assert.equal(below.title, "지금은 달이 하늘 아래쪽에 있어요");

  const dark = api.MoonEngine.decideObservationGuidance({
    sunAltitudeDeg: -20,
    moonAltitudeDeg: 30,
    illuminationFraction: 0.049,
  });
  assert.equal(dark.kind, "too-dark");
  assert.equal(dark.title, "오늘은 하늘에서 달을 보기 어려워요");

  const visible = api.MoonEngine.decideObservationGuidance({
    sunAltitudeDeg: -20,
    moonAltitudeDeg: 30,
    illuminationFraction: 0.05,
  });
  assert.equal(visible.kind, "observable");
  assert.equal(visible.title, "지금 달을 관찰해 볼 수 있어요");

  const hardDay = api.MoonEngine.decideObservationGuidance({
    sunAltitudeDeg: 10,
    moonAltitudeDeg: 20,
    illuminationFraction: 0.8,
    hardDay: true,
  });
  assert.equal(hardDay.kind, "hard-day");
  assert.equal(hardDay.title, "오늘은 달을 관찰하기 어려운 날이에요");
});

test("student evening hours run from 17:00 inclusive to 01:00 exclusive", () => {
  const { api } = loadStudentPage();
  assert.equal(api.MoonEngine.isStudentObservationHour(new Date(2026, 8, 9, 16, 59, 0)), false);
  assert.equal(api.MoonEngine.isStudentObservationHour(new Date(2026, 8, 9, 17, 0, 0)), true);
  assert.equal(api.MoonEngine.isStudentObservationHour(new Date(2026, 8, 9, 0, 59, 0)), true);
  assert.equal(api.MoonEngine.isStudentObservationHour(new Date(2026, 8, 9, 1, 0, 0)), false);
  assert.equal(api.MoonEngine.isStudentObservationHour(new Date(2026, 8, 9, 5, 10, 0)), false);
});

test("recommended observation windows stay above the moon, below twilight, and in the evening", () => {
  const { api } = loadStudentPage();
  const lat = 36.5;
  const lon = 127.5;
  let found = null;
  for (let day = 0; day < 14; day += 1) {
    found = api.MoonEngine.findNextObservationWindow(new Date(2026, 8, 1 + day, 12, 0, 0), lat, lon);
    if (found) break;
  }
  assert.ok(found, "a recommended window should exist within two weeks of 2026-09-01");
  assert.equal(api.MoonEngine.isLateNightHour(found.time), false);
  assert.equal(api.MoonEngine.isStudentObservationHour(found.time), true);
  assert.ok(api.MoonEngine.getMoonPosition(found.time, lat, lon).altitude * 180 / Math.PI >= 5);
  assert.ok(api.MoonEngine.getSunPosition(found.time, lat, lon).altitude * 180 / Math.PI <= -6);

  const lateStart = new Date(found.time.getFullYear(), found.time.getMonth(), found.time.getDate(), 1, 0, 0);
  const afterLate = api.MoonEngine.findNextObservationWindow(lateStart, lat, lon);
  if (afterLate) {
    assert.equal(api.MoonEngine.isLateNightHour(afterLate.time), false);
    assert.equal(api.MoonEngine.isStudentObservationHour(afterLate.time), true);
    assert.ok(afterLate.time.getTime() >= lateStart.getTime());
  }
});

test("late-night boundaries are 01:00 inclusive and 05:00 exclusive", () => {
  const { api } = loadStudentPage();
  assert.equal(api.MoonEngine.isLateNightHour(new Date(2026, 8, 9, 0, 59, 0)), false);
  assert.equal(api.MoonEngine.isLateNightHour(new Date(2026, 8, 9, 1, 0, 0)), true);
  assert.equal(api.MoonEngine.isLateNightHour(new Date(2026, 8, 9, 4, 59, 0)), true);
  assert.equal(api.MoonEngine.isLateNightHour(new Date(2026, 8, 9, 5, 0, 0)), false);
});

test("late-night dialog appears once per page load", () => {
  const page = loadStudentPage();
  const now = new Date(2026, 8, 9, 2, 0, 0);
  assert.equal(page.api.maybeShowLateNightDialog(now), true);
  assert.equal(page.element("lateNightDialog").classList.contains("hidden"), false);
  assert.equal(page.element("lateNightRestButton").focused, true);
  assert.equal(page.api.maybeShowLateNightDialog(now), false);
  page.api.stayFromLateNight();
  assert.equal(page.element("lateNightDialog").classList.contains("hidden"), true);
  assert.equal(page.api.maybeShowLateNightDialog(now), false);
});

test("sensor permission is requested only after the compass button click", async () => {
  const page = loadStudentPage();
  assert.equal(page.permissionCalls.count, 0);
  page.api.showView("submit");
  assert.equal(page.permissionCalls.count, 0);
  await page.api.openCompass();
  assert.equal(page.permissionCalls.count, 1);
  const beforeOpen = script.split("async function openCompass")[0];
  assert.doesNotMatch(beforeOpen, /requestPermission/);
});

test("compass errors keep static direction text and leave photo submission enabled", async () => {
  const unsupported = loadStudentPage({ DeviceOrientationEvent: undefined });
  unsupported.element("submitButton").disabled = false;
  await unsupported.api.openCompass();
  assert.equal(unsupported.element("submitButton").disabled, false);
  assert.match(unsupported.element("compassStatus").textContent, /지원하지 않/);
  assert.ok(unsupported.element("compassStaticDirection").textContent.length > 0);
  assert.equal(unsupported.storage.size, 0);

  const denied = loadStudentPage({
    DeviceOrientationEvent: class {
      static requestPermission() {
        return Promise.resolve("denied");
      }
    },
  });
  denied.element("submitButton").disabled = false;
  await denied.api.openCompass();
  assert.equal(denied.element("submitButton").disabled, false);
  assert.match(denied.element("compassStatus").textContent, /허용하지 않아서/);
  assert.ok(denied.element("compassStaticDirection").textContent.length > 0);

  const noSensor = loadStudentPage({
    setTimeout(callback) {
      callback();
      return 1;
    },
  });
  noSensor.element("submitButton").disabled = false;
  await noSensor.api.openCompass();
  assert.equal(noSensor.element("submitButton").disabled, false);
  assert.match(noSensor.element("compassStatus").textContent, /센서 값/);
});

test("today view fills easy brightness labels from calculated moon data", () => {
  const page = loadStudentPage();
  page.api.renderToday();
  assert.match(page.element("illuminationBadge").textContent, /밝은 정도 .+ \(밝기\)/);
  assert.match(page.element("moonAgeBadge").textContent, /달의 나이 .+ \(월령\)/);
  assert.ok(["북쪽", "동쪽", "남쪽", "서쪽", ""].includes(page.element("moonriseDirection").textContent));
});

function findSampleObservationDays(api) {
  const lat = 36.5;
  const lon = 127.5;
  let hardDay = null;
  let easyDay = null;
  for (let day = 1; day <= 45; day += 1) {
    const date = new Date(2026, 8, day, 12, 0, 0);
    if (api.MoonEngine.isHardObservationDay(date, lat, lon)) {
      if (!hardDay) hardDay = date;
    } else if (!easyDay) {
      easyDay = date;
    }
    if (hardDay && easyDay) break;
  }
  return { hardDay, easyDay };
}

test("a day is hard when the moon is only up in daylight or late night", () => {
  const { api } = loadStudentPage();
  const { hardDay, easyDay } = findSampleObservationDays(api);
  assert.ok(hardDay, "expected a hard observation day near September 2026");
  assert.ok(easyDay, "expected a student-friendly observation day near September 2026");
  assert.equal(api.MoonEngine.isHardObservationDay(new Date(2026, 8, 9, 12, 0, 0), 36.5, 127.5), true);
  assert.equal(api.MoonEngine.isHardObservationDay(hardDay, 36.5, 127.5), true);
  assert.equal(api.MoonEngine.isHardObservationDay(easyDay, 36.5, 127.5), false);

  const windowOnEasy = api.MoonEngine.findNextObservationWindow(
    new Date(easyDay.getFullYear(), easyDay.getMonth(), easyDay.getDate(), 0, 0, 0),
    36.5,
    127.5,
  );
  assert.ok(windowOnEasy);
  assert.equal(windowOnEasy.time.getFullYear(), easyDay.getFullYear());
  assert.equal(windowOnEasy.time.getMonth(), easyDay.getMonth());
  assert.equal(windowOnEasy.time.getDate(), easyDay.getDate());
  assert.equal(api.MoonEngine.isLateNightHour(windowOnEasy.time), false);
});

test("hard-day cards use a high-contrast warning color", () => {
  const page = loadStudentPage();
  const { hardDay, easyDay } = findSampleObservationDays(page.api);
  assert.ok(hardDay);
  assert.ok(easyDay);

  page.api.renderSubmitObservationSupport(new Date(hardDay.getFullYear(), hardDay.getMonth(), hardDay.getDate(), 15, 0, 0));
  assert.equal(page.element("observationGuidanceTitle").textContent, "오늘은 달을 관찰하기 어려운 날이에요");
  assert.match(page.element("observationGuidanceDetail").textContent, /늦은 밤이나 새벽/);
  assert.match(page.element("observationGuidanceCard").className, /border-amber-400/);
  assert.match(page.element("observationGuidanceCard").className, /bg-amber-400\/25/);
  assert.match(page.element("observationGuidanceTitle").className, /text-amber-100/);
  assert.equal(page.element("observationGuidanceNext").textContent, "");
  assert.equal(page.element("observationGuidanceNext").classList.contains("hidden"), true);
  assert.doesNotMatch(page.element("observationGuidanceDetail").textContent, /오늘은 달을 보기 어려워요/);

  page.api.setSelectedDate(hardDay);
  page.api.renderToday();
  assert.equal(page.element("observationTipHeading").textContent, "오늘은 달을 관찰하기 어려운 날이에요");
  assert.match(page.element("observationTipCard").className, /border-amber-400/);
  assert.match(page.element("observationTip").textContent, /늦은 밤이나 새벽/);

  page.api.setSelectedDate(easyDay);
  page.api.renderToday();
  assert.equal(page.element("observationTipHeading").textContent, "🔭 관찰 도움말");
  assert.match(page.element("observationTipCard").className, /border-blue-400/);
  assert.doesNotMatch(page.element("observationTipCard").className, /border-amber-400/);
});
