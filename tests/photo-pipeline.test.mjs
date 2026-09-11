import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const pipelinePath = new URL('../public/photo-pipeline.js', import.meta.url);
const workerPath = new URL('../public/photo-worker.js', import.meta.url);

function jpeg(width, height, name = 'moon.jpg') {
  const bytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  const file = new Blob([bytes], { type: 'image/jpeg' });
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function png(width, height, name = 'moon.png') {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  const file = new Blob([bytes], { type: 'image/png' });
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function metadata(width, height, jpegSource = true) {
  return { width, height, jpeg: jpegSource };
}

function loadPipeline(overrides = {}) {
  const canvases = [];
  const encodes = [];
  const bitmaps = [];
  const images = [];
  const urls = [];
  const revocations = [];
  const workers = [];
  const diagnostics = [];
  let urlIndex = 0;
  const imageSize = overrides.imageSize || [1200, 800];
  const toBlob = overrides.toBlob || function defaultToBlob(callback) {
    callback(new Blob(['safe-jpeg'], { type: 'image/jpeg' }));
  };
  class BrowserImage {
    constructor() {
      this.naturalWidth = imageSize[0];
      this.naturalHeight = imageSize[1];
      images.push(this);
    }
    set src(value) {
      this._src = value;
      if (value) setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  class BrowserWorker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(message, transfer) {
      this.message = message;
      this.transfer = transfer;
      const result = overrides.workerResult || { type: 'decoded', width: 1600, height: 1200, rgba: new ArrayBuffer(1600 * 1200 * 4) };
      setTimeout(() => this.onmessage?.({ data: result }), 0);
    }
    terminate() { this.terminated = true; }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const context2d = {
        drawImage(...args) { canvas.draws.push(args); },
        putImageData(...args) { canvas.puts.push(args); },
        fillRect() {},
      };
      const canvas = {
        width: 0,
        height: 0,
        draws: [],
        puts: [],
        getContext: () => context2d,
        toBlob(callback, type, quality) {
          encodes.push({ canvas, width: canvas.width, height: canvas.height, type, quality });
          return toBlob.call(canvas, callback, type, quality);
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  const source = existsSync(pipelinePath) ? readFileSync(pipelinePath, 'utf8') : '';
  const context = {
    Blob,
    ArrayBuffer,
    DataView,
    Uint8Array,
    Uint8ClampedArray,
    Promise,
    setTimeout,
    clearTimeout,
    ImageData: class ImageData {
      constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
    },
    URL: {
      createObjectURL(file) { const url = `blob:photo-${++urlIndex}`; urls.push({ file, url }); return url; },
      revokeObjectURL(url) { revocations.push(url); },
    },
    document,
    Image: BrowserImage,
    Worker: BrowserWorker,
    localStorage: { setItem(key, value) { diagnostics.push({ key, value }); }, getItem() { return null; } },
    console: { error() {}, warn() {}, log() {} },
    ...overrides,
  };
  runInNewContext(`${source}\nglobalThis.pipeline = globalThis.MoonPhotoPipeline;`, context, { filename: 'photo-pipeline.js' });
  return { context, pipeline: context.pipeline, canvases, encodes, bitmaps, images, urls, revocations, workers, diagnostics };
}

test('exposes the reusable compress API', () => {
  const browser = loadPipeline();
  assert.equal(typeof browser.pipeline?.compress, 'function');
});

test('small JPEG releases the bitmap before one quality-controlled JPEG encode', async () => {
  let browser;
  browser = loadPipeline({
    createImageBitmap: async (_file, options) => {
      const bitmap = {
        width: options.resizeWidth,
        height: options.resizeHeight,
        closed: false,
        close() { this.closed = true; },
      };
      browser.bitmaps.push(bitmap);
      return bitmap;
    },
    toBlob(callback) {
      assert.equal(browser.bitmaps[0].closed, true, 'decoder must be released before encoder allocation');
      callback(new Blob(['safe-jpeg'], { type: 'image/jpeg' }));
    },
  });
  const result = await browser.pipeline.compress(jpeg(4000, 3000), {
    metadata: metadata(4000, 3000), maxSide: 2000, quality: 0.73, maxOutputBytes: 100,
  });
  assert.equal(result.type, 'image/jpeg');
  assert.deepEqual(browser.bitmaps[0].width, 2000);
  assert.deepEqual(browser.bitmaps[0].height, 1500);
  assert.deepEqual(browser.encodes.map(({ type, quality }) => [type, quality]), [['image/jpeg', 0.73]]);
  assert.deepEqual(browser.canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0]]);
});

test('a bitmap decode rejection retries once through an object-URL Image', async () => {
  let bitmapCalls = 0;
  const browser = loadPipeline({
    createImageBitmap: async () => { bitmapCalls += 1; throw new Error('bitmap decoder rejected'); },
    toBlob(callback) {
      assert.equal(browser.images[0]._src, '', 'Image source must be released before encoder allocation');
      callback(new Blob(['safe-jpeg'], { type: 'image/jpeg' }));
    },
  });
  const result = await browser.pipeline.compress(jpeg(1200, 800), { metadata: metadata(1200, 800), maxOutputBytes: 100 });
  assert.equal(result.type, 'image/jpeg');
  assert.equal(bitmapCalls, 1);
  assert.equal(browser.images.length, 1);
  assert.deepEqual(browser.revocations, ['blob:photo-1']);
});

test('uses an object-URL Image directly when createImageBitmap is unavailable', async () => {
  const browser = loadPipeline({ createImageBitmap: undefined });
  const result = await browser.pipeline.compress(jpeg(1200, 800), { metadata: metadata(1200, 800), maxOutputBytes: 100 });
  assert.equal(result.type, 'image/jpeg');
  assert.equal(browser.images.length, 1);
  assert.deepEqual(browser.revocations, ['blob:photo-1']);
});

test('a 5222 by 6024 JPEG uses only the reduced-IDCT Worker path', async () => {
  const browser = loadPipeline({
    createImageBitmap: () => { throw new Error('native bitmap path must not run'); },
    Image: class { constructor() { throw new Error('native Image path must not run'); } },
    workerResult: { type: 'decoded', width: 2221, height: 2560, rgba: new ArrayBuffer(2221 * 2560 * 4) },
  });
  const result = await browser.pipeline.compress(jpeg(5222, 6024), {
    metadata: metadata(5222, 6024), maxSide: 2560, maxOutputBytes: 100,
  });
  assert.equal(result.type, 'image/jpeg');
  assert.equal(browser.workers.length, 1);
  assert.equal(browser.workers[0].url, '/photo-worker.js');
  assert.ok(browser.workers[0].message.buffer instanceof ArrayBuffer);
  assert.equal(browser.images.length, 0);
  assert.equal(browser.workers[0].terminated, true);
});

test('a reduced-IDCT Worker error never falls back to native decoders', async () => {
  const browser = loadPipeline({
    createImageBitmap: () => { throw new Error('native bitmap path must not run'); },
    Image: class { constructor() { throw new Error('native Image path must not run'); } },
    workerResult: { type: 'error', code: 'decode-failed' },
  });
  await assert.rejects(
    browser.pipeline.compress(jpeg(5222, 6024), { metadata: metadata(5222, 6024), maxOutputBytes: 100 }),
    (error) => error?.code === 'decode-failed',
  );
  assert.equal(browser.workers.length, 1);
  assert.equal(browser.workers[0].terminated, true);
  assert.equal(browser.images.length, 0);
  assert.equal(browser.canvases.length, 0);
});

test('null canvas output rejects and clears every canvas', async () => {
  const browser = loadPipeline({
    createImageBitmap: async () => ({ width: 1200, height: 800, close() {} }),
    toBlob(callback) { callback(null); },
  });
  await assert.rejects(
    browser.pipeline.compress(jpeg(1200, 800), { metadata: metadata(1200, 800) }),
    (error) => error?.code === 'encode-empty',
  );
  assert.deepEqual(browser.canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0]]);
});

test('thrown canvas encoding rejects and clears every canvas', async () => {
  const browser = loadPipeline({
    createImageBitmap: async () => ({ width: 1200, height: 800, close() {} }),
    toBlob() { throw new Error('browser encoder broke'); },
  });
  await assert.rejects(
    browser.pipeline.compress(jpeg(1200, 800), { metadata: metadata(1200, 800) }),
    (error) => error?.code === 'encode-failed',
  );
  assert.deepEqual(browser.canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0]]);
});

test('rejects an oversized JPEG result after exactly one encode', async () => {
  const browser = loadPipeline({
    createImageBitmap: async () => ({ width: 1200, height: 800, close() {} }),
    toBlob(callback) { callback(new Blob([new Uint8Array(11)], { type: 'image/jpeg' })); },
  });
  await assert.rejects(
    browser.pipeline.compress(jpeg(1200, 800), { metadata: metadata(1200, 800), maxOutputBytes: 10 }),
    (error) => error?.code === 'output-limit',
  );
  assert.equal(browser.encodes.length, 1);
  assert.deepEqual(browser.canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0]]);
});

test('a too-wide reduced worker result receives one final output-sized resize', async () => {
  const browser = loadPipeline({
    workerResult: { type: 'decoded', width: 8000, height: 1000, rgba: new ArrayBuffer(8000 * 1000 * 4) },
  });
  const result = await browser.pipeline.compress(jpeg(5222, 6024), {
    metadata: metadata(5222, 6024), maxSide: 2560, maxOutputBytes: 100,
  });
  assert.equal(result.type, 'image/jpeg');
  assert.deepEqual(browser.encodes.map(({ width, height }) => [width, height]), [[2560, 320]]);
  assert.deepEqual(browser.canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0], [0, 0]]);
});

test('a large non-JPEG is rejected before Worker or native decoder allocation', async () => {
  let bitmapCalls = 0;
  const browser = loadPipeline({
    createImageBitmap: async () => { bitmapCalls += 1; throw new Error('must not decode'); },
    Image: class { constructor() { throw new Error('must not decode'); } },
  });
  await assert.rejects(
    browser.pipeline.compress(png(8000, 3000), { metadata: metadata(8000, 3000, false) }),
    (error) => error?.code === 'non-jpeg-limit',
  );
  assert.equal(bitmapCalls, 0);
  assert.equal(browser.images.length, 0);
  assert.equal(browser.workers.length, 0);
});

test('local diagnostics redact filename, memo, student data, credentials, and authorization', async () => {
  const secrets = {
    filename: '김학생-관찰-비밀.jpg', memo: '보름달 관찰 메모', student: '학생 4-3-17', credential: 'secret-password', authorization: 'Bearer top-secret',
  };
  const browser = loadPipeline({
    createImageBitmap: async () => { throw new Error(secrets.authorization); },
    Image: class {
      set src(value) { if (value) this.onerror?.(); }
      removeAttribute() {}
    },
  });
  await assert.rejects(
    browser.pipeline.compress(jpeg(1200, 800, secrets.filename), {
      metadata: { ...metadata(1200, 800), ...secrets }, memo: secrets.memo, student: secrets.student, credential: secrets.credential, authorization: secrets.authorization,
    }),
  );
  const recorded = JSON.stringify(browser.diagnostics);
  for (const secret of Object.values(secrets)) assert.equal(recorded.includes(secret), false);
  assert.equal(browser.context.fetch, undefined, 'diagnostics remain local');
});

test('the worker accepts bounded bytes, returns bounded RGBA, and frees its codec allocation', async () => {
  const source = existsSync(workerPath) ? readFileSync(workerPath, 'utf8') : '';
  const messages = [];
  const calls = [];
  const self = { postMessage(message) { messages.push(message); }, close() { calls.push('close'); } };
  const codec = {
    HEAPU8: new Uint8Array(128),
    _malloc(length) { calls.push(['malloc', length]); return 8; },
    _free(pointer) { calls.push(['free', pointer]); },
    _moon_decode() { return 0; },
    _moon_width() { return 2; }, _moon_height() { return 2; }, _moon_length() { return 16; }, _moon_data() { return 16; },
    _moon_source_width() { return 5222; }, _moon_source_height() { return 6024; }, _moon_progressive() { return 0; }, _moon_release() { calls.push('release'); },
  };
  const workerContext = {
    ArrayBuffer, DataView, Uint8Array, self,
    importScripts(path) { calls.push(['importScripts', path]); },
    createMoonJpegCodec: async () => codec,
  };
  runInNewContext(source, workerContext, { filename: 'photo-worker.js' });
  assert.equal(typeof self.onmessage, 'function');
  await self.onmessage({ data: { type: 'decode', maxSide: 2560, buffer: jpeg(1200, 800).arrayBuffer ? await jpeg(1200, 800).arrayBuffer() : new ArrayBuffer(0) } });
  assert.deepEqual(calls.slice(0, 2), [['importScripts', './vendor/moon-jpeg-codec.js'], ['malloc', 23]]);
  assert.equal(messages.at(-1).type, 'decoded');
  assert.ok(messages.at(-1).rgba instanceof ArrayBuffer || messages.at(-1).buffer instanceof ArrayBuffer);
  assert.deepEqual(calls.slice(-3), [['free', 8], 'release', 'close']);
});
