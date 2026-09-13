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
  compassHeadingFromEuler, headingFromOrientationEvent, compassTilt, applyCompassTarget,
  compassCircularMean, compassSpreadDegrees,
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

test("눕힌 휴대폰의 화면 위쪽을 기준으로 작은 기울임과 화면 회전을 보정한다", () => {
  const { api } = loadStudentPage();
  for (const [alpha, expected] of [[0, 0], [90, 270], [180, 180], [270, 90]]) {
    for (const [beta, gamma] of [[0, 0], [20, 0], [0, 20], [-15, -15]]) {
      assert.ok(Math.abs(api.compassHeadingFromEuler(alpha, beta, gamma) - expected) < 1e-8);
    }
  }
  assert.equal(api.compassHeadingFromEuler(0, 0, 20, 90), 90);
  assert.equal(api.compassHeadingFromEuler(0, 20, 0, 270), 270);
  assert.equal(api.compassHeadingFromEuler(0, 0, 0, 180), 180);
  assert.equal(api.compassHeadingFromEuler(0, 90, 0), null);
  assert.equal(api.compassHeadingFromEuler(NaN, 0, 0), null);
  assert.equal(api.compassTilt({ beta: null, gamma: 0 }), null);
  assert.equal(api.compassTilt({ beta: 180, gamma: 0 }), 180);
});

test("상대 방향은 거부하고 Safari의 정확도와 가로 화면 보정을 적용한다", () => {
  const { api } = loadStudentPage({ screen: { orientation: { angle: 90 } } });
  const pose = { alpha: 90, beta: 0, gamma: 0 };
  assert.equal(api.headingFromOrientationEvent(pose, false), null);
  assert.equal(api.headingFromOrientationEvent({ ...pose, absolute: true }, false), 0);
  assert.equal(api.headingFromOrientationEvent({ ...pose, webkitCompassHeading: 270 }, false), 0);
  for (const accuracy of [-1, 30]) {
    assert.equal(api.headingFromOrientationEvent({ ...pose, webkitCompassHeading: 270, webkitCompassAccuracy: accuracy }, false), null);
  }
});

function compassRoseDegrees(page) {
  const match = page.element('compassRose').getAttribute('transform')?.match(/rotate\(([-0-9.]+)/);
  return match ? Number(match[1]) : NaN;
}

async function connectedCompassPage() {
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  let nowMs = 1_700_000_000_000;
  const RealDate = Date;
  class TestDate extends RealDate {
    static now() {
      return nowMs;
    }
  }
  const page = loadStudentPage({
    Date: TestDate,
    screen: { orientation: { angle: 0 } },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  await page.api.openCompass();
  page.api.applyCompassTarget({ compassDeg: 90, altitude: 30, label: '지금 달이 있는 쪽' });
  const emit = (event = {}) => {
    // 보정은 값이 비슷한 채로 약 1.2초가 흘러야 끝납니다. 시험에서는 시계를 조금 앞으로 밉니다.
    nowMs += 200;
    listeners.get('deviceorientation')({ alpha: 0, beta: 0, gamma: 0, absolute: true, ...event });
  };
  // 센서 준비(보정)가 끝나야 실제 방위 안내가 시작됩니다. 시험에서는 값을 조금씩 흔들어 그 과정을 흉내 냅니다.
  const calibrate = (alpha = 0) => {
    for (const drift of [4, -4, 3, -3, 2, -2, 1, -1, 0, 0]) emit({ alpha: alpha + drift });
  };
  return { ...page, emit, calibrate, listeners, timers };
}

test("나침반을 열면 바로 방위를 말하지 않고 숫자 8 보정 안내부터 보여 준다", async () => {
  const page = await connectedCompassPage();
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
  assert.match(page.element('compassModeLabel').textContent, /학습 그림/);
  assert.match(page.element('compassInstruction').textContent, /숫자 8/);
  assert.match(page.element('compassInstruction').textContent, /금속/);
  // 보정 중에는 실제 방위를 알려 주지 않습니다.
  page.emit({ alpha: 270 });
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
  assert.equal(page.element('compassFront').getAttribute('visibility'), 'hidden');
  assert.match(page.element('compassModeLabel').textContent, /준비하는 중/);
  // 손이 안정됐다고 판단되면 그때부터 실제 방위와 달을 보여 줍니다.
  page.calibrate(270);
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'visible');
  assert.ok(Math.abs(Number(page.element('compassNorth').getAttribute('x')) - 48) < 0.2);
  assert.ok(Math.abs(Number(page.element('compassEast').getAttribute('y')) - 48) < 0.2);
  assert.ok(Math.abs(compassRoseDegrees(page) + 90) < 0.2, `rose ${page.element('compassRose').getAttribute('transform')}`);
  const moon = page.element('compassMoon').getAttribute('transform')?.match(/translate\(([-0-9.]+) ([-0-9.]+)\)/);
  assert.ok(moon && Math.abs(Number(moon[1]) - 140) < 1 && Math.abs(Number(moon[2]) - 70) < 1, `moon ${page.element('compassMoon').getAttribute('transform')}`);
  assert.match(page.element('compassFacingLabel').textContent, /동쪽/);
  assert.match(page.element('compassInstruction').textContent, /올려다봐요/);
});

test("세움·뒤집음·자세 누락에서는 실시간 안내를 지우고 다시 눕히면 복구한다", async () => {
  const page = await connectedCompassPage();
  page.calibrate();
  for (const event of [{ beta: 90 }, { beta: 180 }, { gamma: 80 }, { beta: null }]) {
    page.emit(event);
    assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
    assert.equal(page.element('compassFront').getAttribute('visibility'), 'hidden');
    assert.match(page.element('compassModeLabel').textContent, /학습 그림/);
    page.emit();
    assert.equal(page.element('compassMoon').getAttribute('visibility'), 'visible');
  }
  page.emit({ beta: 35 });
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'visible');
  page.emit({ beta: 41 });
  page.emit({ beta: 35 });
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
});

test("북쪽 359도 경계를 짧게 이어서 돌리고 화면 회전 때는 이전 방향을 섞지 않는다", async () => {
  const page = await connectedCompassPage();
  page.calibrate();
  page.emit({ alpha: 1 });
  page.emit({ alpha: 359 });
  // 359도와 1도는 짧은 쪽으로 이어지므로, 한 바퀴 돌아 180도 근처로 가지 않습니다.
  const wrapped = ((compassRoseDegrees(page) % 360) + 360) % 360;
  assert.ok(wrapped < 1 || wrapped > 359, `unexpected wrap ${wrapped}`);
  page.context.screen.orientation.angle = 90;
  page.emit({ alpha: 0 });
  assert.ok(Math.abs(compassRoseDegrees(page) + 90) < 0.01);
});

test("달이 뒤에 있으면 뒤쪽 안내를 하고 지평선 아래에 있으면 달 표시를 숨긴다", async () => {
  const page = await connectedCompassPage();
  page.calibrate();
  page.api.applyCompassTarget({ compassDeg: 180, altitude: 10, label: '지금 달이 있는 쪽' });
  page.emit();
  assert.match(page.element('compassInstruction').textContent, /뒤쪽/);
  assert.match(page.element('compassHeightHint').textContent, /낮은 하늘/);
  page.api.applyCompassTarget({ compassDeg: 90, altitude: null, label: '다음에 달이 뜨는 쪽', rise: new Date() });
  page.emit();
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
  assert.match(page.element('compassInstruction').textContent, /지평선 위에 없어요/);
  assert.match(page.element('compassHeightHint').textContent, /떠요/);
});

test("방향 값이 끊기거나 닫히면 오래된 안내와 센서 구독을 남기지 않는다", async () => {
  const page = await connectedCompassPage();
  page.calibrate();
  page.emit();
  const timeout = [...page.timers.values()].at(-1);
  timeout();
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
  assert.match(page.element('compassStatus').textContent, /끊겼어요/);
  page.emit();
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'visible');
  page.api.closeCompass();
  assert.equal(page.listeners.size, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.element('compassMoon').getAttribute('visibility'), 'hidden');
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

test("student moon times follow the evening-to-after-midnight night, not calendar midnight", () => {
  const page = loadStudentPage();
  const { api } = page;
  const lat = 36.5;
  const lon = 127.5;

  const sep5 = api.MoonEngine.resolveMoonEvents(new Date(2026, 8, 5, 12), lat, lon);
  assert.ok(sep5.rise);
  assert.ok(sep5.set);
  assert.equal(sep5.rise.getHours(), 0);
  assert.equal(sep5.rise.getMinutes(), 3);
  assert.equal(sep5.set.getHours(), 15);
  assert.equal(sep5.set.getMinutes(), 47);

  const sep20 = api.MoonEngine.resolveMoonEvents(new Date(2026, 8, 20, 12), lat, lon);
  assert.ok(sep20.rise);
  assert.ok(sep20.set);
  assert.equal(sep20.rise.getHours(), 14);
  assert.equal(sep20.rise.getMinutes(), 54);
  assert.equal(sep20.set.getHours(), 0);
  assert.equal(sep20.set.getMinutes(), 26);

  const oct4 = api.MoonEngine.resolveMoonEvents(new Date(2026, 9, 4, 12), lat, lon);
  assert.ok(oct4.rise);
  assert.ok(oct4.set);
  assert.equal(oct4.rise.getHours(), 0);
  assert.equal(oct4.rise.getMinutes(), 11);

  page.api.setSelectedDate(new Date(2026, 8, 5, 12));
  page.api.renderToday();
  assert.equal(page.element("moonriseTime").textContent, "00:03");
  assert.equal(page.element("moonsetTime").textContent, "15:47");
  assert.doesNotMatch(page.element("moonriseTime").textContent, /전날|다음날|관찰 어려움/);
  assert.doesNotMatch(page.element("moonsetTime").textContent, /전날|다음날|관찰 어려움/);

  page.api.setSelectedDate(new Date(2026, 8, 20, 12));
  page.api.renderToday();
  assert.equal(page.element("moonriseTime").textContent, "14:54");
  assert.equal(page.element("moonsetTime").textContent, "00:26");
  assert.doesNotMatch(page.element("moonsetTime").textContent, /전날|다음날|관찰 어려움/);

  page.api.setSelectedDate(new Date(2026, 9, 4, 12));
  page.api.renderToday();
  assert.equal(page.element("moonriseTime").textContent, "00:11");
  assert.doesNotMatch(page.element("moonriseTime").textContent, /전날|다음날|관찰 어려움/);
});
