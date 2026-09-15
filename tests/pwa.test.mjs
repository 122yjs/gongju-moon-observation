import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

test("student page advertises an installable standalone PWA", async () => {
  const html = await readFile(publicFile("index.html"), "utf8");
  const manifest = JSON.parse(await readFile(publicFile("manifest.webmanifest"), "utf8"));

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /id="pwaInstallBanner"/);
  assert.match(html, /id="pwaInstallDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /beforeinstallprompt/);
  assert.match(html, /navigator\.standalone === true/);

  assert.equal(manifest.name, "달 관찰 탐험대");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("PWA icons and iOS home-screen icon are shipped", async () => {
  await Promise.all([
    access(publicFile("pwa-icon-192.png")),
    access(publicFile("pwa-icon-512.png")),
    access(publicFile("apple-touch-icon.png")),
  ]);
});

test("service worker enables installation without caching stale classroom builds", async () => {
  const serviceWorker = await readFile(publicFile("service-worker.js"), "utf8");
  assert.match(serviceWorker, /addEventListener\('install'/);
  assert.match(serviceWorker, /addEventListener\('activate'/);
  assert.match(serviceWorker, /skipWaiting\(\)/);
  assert.match(serviceWorker, /clients\.claim\(\)/);
  assert.doesNotMatch(serviceWorker, /addEventListener\(['"]fetch['"]/);
  assert.doesNotMatch(serviceWorker, /caches\.open|cache\.put|respondWith/);
});

test("student install guidance covers Android, iOS, in-app browsers, and dismissal", async () => {
  const html = await readFile(publicFile("index.html"), "utf8");
  assert.match(html, /iPhone\|iPad\|iPod/);
  assert.match(html, /Android/);
  assert.match(html, /NAVER\|KAKAOTALK\|KAKAO/);
  assert.match(html, /수업 QR을 Safari에서 다시 연 뒤 홈 화면에 추가/);
  assert.match(html, /수업 QR을 Chrome에서 다시 연 뒤 설치/);
  assert.match(html, /!hasClassSession \|\| isPwaStandalone\(\)/);
  assert.match(html, /PWA_INSTALL_DISMISS_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(html, /PWA_INSTALL_INTRO_SEEN_KEY = 'moon-pwa-install-intro-seen-v1'/);
  assert.match(html, /function maybeShowInitialPwaInstallDialog\(\)/);
  assert.match(html, /markPwaInstallIntroSeen\(\)/);
  assert.match(html, /팝업은 처음 한 번만 보여요/);
  assert.match(html, /serviceWorker\.register\('\/service-worker\.js'/);
});
