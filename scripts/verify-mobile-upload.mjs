import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Local-only browser verification. A real Playwright browser runs the shipped
// photo pipeline and WASM codec; session and submission APIs are synthetic.
// npm i --no-save playwright, or point MOON_PLAYWRIGHT_MODULE at an installed
// playwright/index.mjs. No production requests or student data are used.
const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.MOON_PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const outputDir = path.join(root, '.wrangler', 'mobile-upload-qa');
await mkdir(outputDir, { recursive: true });
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css']],
  ['/photo-pipeline.js', ['photo-pipeline.js', 'text/javascript']],
  ['/photo-worker.js', ['photo-worker.js', 'text/javascript']],
  ['/vendor/moon-jpeg-codec.js', ['vendor/moon-jpeg-codec.js', 'text/javascript']],
  ['/tenant-label.js', ['tenant-label.js', 'text/javascript']],
  ['/compass-calibration-guide.jpg', ['compass-calibration-guide.jpg', 'image/jpeg']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const asset = assets.get(pathname);
    if (!asset) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
    response.end(await readFile(path.join(root, 'public', asset[0])));
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { at: new Date().toISOString(), kind: 'local-browser-not-physical-phone', productionWrites: 0, engines: [] };

try {
  for (const engine of ['webkit', 'chromium']) {
    const browser = await playwright[engine].launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      let reply = { status: 503, contentType: 'application/json', body: JSON.stringify({ message: '시험용 통신 오류' }) };
      let submissions = 0;
      const externalRequests = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { externalRequests.push(url.origin); await route.abort(); return; }
        if (url.pathname === '/api/session') {
          await route.fulfill({ json: { authenticated: true, draftScope: 'local-qa', classLabel: '검증용 가상 반', observationLat: 36.5, observationLon: 127.5 } });
        } else if (url.pathname === '/api/observations') {
          submissions += 1;
          await route.fulfill(reply);
        } else { await route.continue(); }
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => hasClassSession);
      await page.evaluate(() => showView('submit'));
      await page.locator('#studentNumber').fill('7');
      await page.locator('#studentName').fill('가상 학생');
      await page.locator('#memo').fill('실제 자료를 사용하지 않는 사진 처리 검증');
      const results = [];
      const inspectPreview = async () => page.evaluate(async () => {
        const preview = document.getElementById('photoPreview');
        await preview.decode();
        return { width: preview.naturalWidth, height: preview.naturalHeight, bytes: compressedImageBlob.size, type: compressedImageBlob.type };
      });
      for (const fixture of ['original-5222x6024.jpg', 'crop-4015x4594.jpg', 'progressive-5222x6024.jpg', 'oriented-320x480-o6.jpg']) {
        const started = Date.now();
        await page.evaluate(() => { globalThis.__qaPriorPhoto = compressedImageBlob; });
        await page.locator('#photoInput').setInputFiles(path.join(root, 'tests', 'fixtures', fixture));
        await page.waitForFunction(() => !photoProcessing, null, { timeout: 90000 });
        assert.ok(await page.evaluate(() => compressedImageBlob !== null && compressedImageBlob !== globalThis.__qaPriorPhoto), `${engine}: ${fixture} did not replace the old attachment`);
        assert.equal(await page.locator('#photoStatus').isHidden(), true);
        const result = await inspectPreview();
        assert.equal(result.type, 'image/jpeg');
        assert.ok(Math.max(result.width, result.height) <= 2560);
        assert.ok(result.bytes > 0 && result.bytes <= 6 * 1024 * 1024);
        if (fixture.startsWith('oriented')) assert.deepEqual([result.width, result.height], [480, 320]);
        results.push({ fixture, ...result, elapsedMs: Date.now() - started });
      }

      // A legal JPEG with multiple application segments before its frame header.
      const original = await readFile(path.join(root, 'tests', 'fixtures', 'oriented-320x480-o6.jpg'));
      const app2 = Buffer.alloc(65536); app2.set([0xff, 0xe2, 0xff, 0xfe]);
      const padded = Buffer.concat([original.subarray(0, 2), app2, app2, app2, app2, app2, original.subarray(2)]);
      await page.evaluate(() => { globalThis.__qaPriorPhoto = compressedImageBlob; });
      await page.locator('#photoInput').setInputFiles({ name: 'large-header.jpg', mimeType: 'application/octet-stream', buffer: padded });
      await page.waitForFunction(() => !photoProcessing);
      assert.equal(await page.evaluate(() => compressedImageBlob !== globalThis.__qaPriorPhoto), true);
      const retained = await inspectPreview();
      assert.deepEqual([retained.width, retained.height], [480, 320]);

      // Unsupported input gives specific guidance and restores the prior preview.
      const heic = Buffer.alloc(24); heic.writeUInt32BE(24, 0); heic.write('ftyp', 4); heic.write('heic', 8);
      await page.locator('#photoInput').setInputFiles({ name: 'unsupported.heic', mimeType: 'image/heic', buffer: heic });
      await page.waitForFunction(() => !photoProcessing);
      assert.match(await page.locator('#photoStatus').innerText(), /HEIC/);
      assert.deepEqual(await inspectPreview(), retained);

      await page.evaluate(() => submitObservation({ preventDefault() {} }));
      assert.equal(submissions, 1);
      assert.ok(await page.evaluate(() => compressedImageBlob && pendingRequestId));
      const requestId = await page.evaluate(() => pendingRequestId);
      reply = { status: 200, contentType: 'text/html', body: '<html>Not a submission receipt</html>' };
      await page.evaluate(() => submitObservation({ preventDefault() {} }));
      assert.equal(submissions, 2);
      assert.match(await page.locator('#submitStatus').innerText(), /제출 확인/);
      assert.equal(await page.evaluate(() => pendingRequestId), requestId);
      assert.deepEqual(await inspectPreview(), retained);
      await page.screenshot({ path: path.join(outputDir, `${engine}-retained-photo.png`), fullPage: true });

      reply = { status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'local-test-observation' }) };
      await page.evaluate(() => submitObservation({ preventDefault() {} }));
      assert.equal(submissions, 3);
      assert.equal(await page.evaluate(() => compressedImageBlob), null);
      assert.equal(await page.evaluate(() => pendingRequestId), '');
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(externalRequests, []);
      const result = { engine, version: browser.version(), photos: results, largeHeader: 'passed', heicGuidanceAndPreviewRecovery: 'passed', failedAndInvalidReceiptRecovery: 'passed', validReceipt: 'passed', pageErrors, externalRequests };
      report.engines.push(result);
      console.log(JSON.stringify(result));
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
}
assert.equal(report.engines.length, 2);
console.log('PASS: WebKit and Chromium local-only upload verification. Physical iPhone/Android and production storage remain untested.');
