import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const pipelineSource = readFileSync(new URL('../public/photo-pipeline.js', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function jpeg(width, height) {
  return new Blob([Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8,
    height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0, 0xff, 0xd9
  ])], { type: 'application/octet-stream' });
}

function browser(overrides = {}) {
  const elements = new Map();
  const canvases = [];
  const decodes = [];
  const revocations = [];
  const workers = [];
  let urlIndex = 0;

  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: '', disabled: false,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        removeAttribute(name) { delete this[name]; }
      });
    }
    return elements.get(id);
  };

  class MockWorker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(message, transfer) {
      this.message = message;
      this.transfer = transfer;
      const result = overrides.workerResult || {
        type: 'decoded',
        width: 2560,
        height: 1920,
        rgba: new ArrayBuffer(2560 * 1920 * 4),
        sourceWidth: 8000,
        sourceHeight: 6000,
        orientation: 1,
      };
      setTimeout(() => this.onmessage?.({ data: result }), 0);
    }
    terminate() { this.terminated = true; }
  }

  const context = {
    Blob, ArrayBuffer, Uint8Array, Uint8ClampedArray, DataView, console, Promise,
    setTimeout: overrides.setTimeout || setTimeout,
    clearTimeout: overrides.clearTimeout || clearTimeout,
    ImageData: class ImageData {
      constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    URL: {
      createObjectURL: () => `blob:photo-${++urlIndex}`,
      revokeObjectURL: (url) => revocations.push(url)
    },
    document: {
      addEventListener() {},
      getElementById: getElement,
      createElement: () => {
        const canvas = {
          width: 0, height: 0,
          getContext: () => ({ fillRect() {}, drawImage() {}, putImageData() {} }),
          toBlob: (callback) => {
            assert.ok(decodes.every((bitmap) => bitmap.closed), 'decoder pixels must be released before encoding');
            callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
          }
        };
        canvases.push(canvas);
        return canvas;
      }
    },
    Worker: overrides.Worker || MockWorker,
    createImageBitmap: overrides.createImageBitmap !== undefined ? overrides.createImageBitmap : async (_file, options) => {
      const bitmap = {
        width: options?.resizeWidth ?? 1200, height: options?.resizeHeight ?? 800, options,
        closed: false, close() { this.closed = true; }
      };
      decodes.push(bitmap);
      return bitmap;
    },
    Image: overrides.Image || class { set src(_value) { throw Error('unbounded Image decode'); } },
    ...overrides,
  };

  runInNewContext(pipelineSource, context, { filename: 'photo-pipeline.js' });
  runInNewContext(script + '\nglobalThis.api = { compressImage, previewPhoto, attachPhoto, startCamera, stopCamera, captureCameraPhoto, submitObservation };', context, { filename: 'index.html' });
  return { context, api: context.api, getElement, canvases, decodes, revocations, workers };
}

test('48 MP JPEG uses safe Worker path, and 12 MP JPEG uses bounded bitmap', async () => {
  const b = browser();
  const result48 = await b.api.compressImage(jpeg(8000, 6000));
  assert.equal(result48.type, 'image/jpeg');
  assert.equal(b.decodes.length, 0, '16MP 초과 JPEG는 브라우저 bitmap 디코더를 호출하지 않음');
  assert.equal(b.workers.length, 1, 'Worker 축소 디코더를 사용해야 함');
  assert.ok(b.workers[0].terminated, 'Worker가 작업 후 종료되어야 함');
  assert.deepEqual(b.canvases.map((c) => [c.width, c.height]), [[0, 0]]);

  const result12 = await b.api.compressImage(jpeg(4000, 3000));
  assert.equal(result12.type, 'image/jpeg');
  assert.equal(b.decodes.length, 1);
  assert.equal(b.decodes[0].options.resizeWidth, 2560);
  assert.equal(b.decodes[0].options.resizeHeight, 1920);
  assert.ok(b.decodes[0].closed);
  assert.deepEqual(b.canvases.map((c) => [c.width, c.height]), [[0, 0], [0, 0]]);
});

test('unsafe dimensions are rejected before either native decoder is invoked', async () => {
  const b = browser();
  await assert.rejects(b.api.compressImage(jpeg(20000, 10000)), /(?:supported image|invalid-image|target-limit|canvas-limit|해상도)/);
  assert.equal(b.decodes.length, 0);
  assert.equal(b.workers.length, 0);
});

test('malformed input is rejected without decoding', async () => {
  const b = browser();
  await assert.rejects(b.api.compressImage(new Blob(['not an image'])), /JPG|사진/);
  assert.equal(b.decodes.length, 0);
});

test('failed canvas encoding still releases all pixel buffers', async () => {
  const b = browser();
  const createCanvas = b.context.document.createElement;
  b.context.document.createElement = () => {
    const canvas = createCanvas();
    canvas.toBlob = () => { throw Error('encode failure'); };
    return canvas;
  };
  await assert.rejects(b.api.compressImage(jpeg(4000, 3000)), /JPEG encoder failed|encode-failed|encode failure/);
  assert.ok(b.decodes.every((bitmap) => bitmap.closed));
  assert.deepEqual(b.canvases.map((c) => [c.width, c.height]), [[0, 0]]);
});

test('overlapping file selections decode one image and suspend the previous preview first', async () => {
  let finish;
  let count = 0;
  let wrapHidden = false;
  const b = browser({ createImageBitmap: async () => {
    count += 1;
    assert.equal(wrapHidden, true);
    await new Promise((resolve) => { finish = resolve; });
    return { width: options.resizeWidth, height: options.resizeHeight, close() {} };
  } });
  b.getElement('photoPreviewWrap').classList.add = (cls) => { if (cls === 'hidden') wrapHidden = true; };
  b.getElement('photoPreviewWrap').classList.remove = (cls) => { if (cls === 'hidden') wrapHidden = false; };
  b.api.attachPhoto(new Blob(['old']));
  const first = b.api.previewPhoto({ target: { files: [jpeg(4000, 3000)], value: 'first.jpg' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.getElement('photoInput').disabled, true);
  assert.equal(b.getElement('submitButton').disabled, true);
  await b.api.previewPhoto({ target: { files: [jpeg(4000, 3000)], value: 'second.jpg' } });
  assert.equal(count, 1);
  finish();
  await first;
  assert.equal(b.getElement('photoInput').disabled, false);
  assert.equal(b.getElement('submitButton').disabled, false);
});

test('EXIF-rotated JPEG requests portrait dimensions without stretching', async () => {
  const exif = Uint8Array.from([0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0,
    73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
  const original = jpeg(4000, 3000);
  const rotated = new Blob([original.slice(0, 2), exif, original.slice(2)]);
  const b = browser();
  await b.api.compressImage(rotated);
  assert.equal(b.decodes[0].options.resizeWidth, 1920);
  assert.equal(b.decodes[0].options.resizeHeight, 2560);
});

test('PNG and WebP dimensions are checked without MIME assumptions', async () => {
  const png = new Uint8Array(24);
  const data = new DataView(png.buffer);
  data.setUint32(0, 0x89504e47); data.setUint32(4, 0x0d0a1a0a);
  data.setUint32(12, 0x49484452); data.setUint32(16, 4000); data.setUint32(20, 3000);
  const b = browser();
  await b.api.compressImage(new Blob([png]));
  assert.equal(b.decodes[0].options.imageOrientation, undefined, 'non-JPEG orientation must be left to the decoder');
  data.setUint32(16, 8000); data.setUint32(20, 6000);
  await assert.rejects(b.api.compressImage(new Blob([png])), /(?:JPEG files|non-jpeg-limit|해상도)/);
  const webp = new Uint8Array(30);
  const w = new DataView(webp.buffer);
  w.setUint32(0, 0x52494646); w.setUint32(8, 0x57454250); w.setUint32(12, 0x56503858);
  w.setUint16(24, 1199, true); w.setUint16(27, 799, true);
  await b.api.compressImage(new Blob([webp]));
  assert.equal(b.decodes[1].width, 1200);
  assert.equal(b.decodes[1].height, 800);
});

test('small legacy images release their Image and URL on both success and error', async () => {
  const images = [];
  class LegacyImage {
    naturalWidth = 4000; naturalHeight = 3000;
    constructor() { images.push(this); }
    set src(value) { this.url = value; if (value) setTimeout(() => this.onload?.(), 0); }
    removeAttribute(name) { if (name === 'src') this.url = ''; }
  }
  const b = browser({ createImageBitmap: undefined, Image: LegacyImage });
  await b.api.compressImage(jpeg(4000, 3000));
  assert.equal(images[0].url, '');
  assert.ok(b.revocations.length >= 1);
  b.context.Image = class extends LegacyImage {
    set src(value) { this.url = value; if (value) setTimeout(() => this.onerror?.(), 0); }
  };
  await assert.rejects(b.api.compressImage(jpeg(4000, 3000)), /(?:could not decode|image-decode-failed|브라우저)/);
  assert.equal(images[1].url, '');
});

test('failed bitmap decoding does not retry a high-resolution full Image decode', async () => {
  let imageDecodes = 0;
  class DangerousImage {
    constructor() { imageDecodes += 1; throw Error('must not decode full Image'); }
  }
  const b = browser({
    createImageBitmap: async () => { throw Error('bitmap error'); },
    Image: DangerousImage,
  });
  await b.api.compressImage(jpeg(8000, 6000));
  assert.equal(imageDecodes, 0);
  assert.equal(b.decodes.length, 0);
  assert.equal(b.workers.length, 1);
});

test('a camera permission response after navigation stops the newly opened tracks', async () => {
  let respond;
  let constraints;
  let stopped = false;
  const b = browser({ navigator: { mediaDevices: { getUserMedia: async (value) => {
    constraints = value;
    return new Promise((resolve) => { respond = resolve; });
  } } } });
  const opening = b.api.startCamera();
  b.api.stopCamera();
  respond({ getTracks: () => [{ stop() { stopped = true; } }] });
  await opening;
  assert.equal(stopped, true);
  assert.equal(b.getElement('cameraPreview').srcObject, null);
  assert.equal(constraints.video.width.max, 2560);
  assert.equal(constraints.video.frameRate.max, 30);
  assert.equal(b.getElement('photoInput').disabled, false);
});

test('PNG with decoder-applied EXIF rotation keeps its portrait aspect ratio', async () => {
  const png = new Uint8Array(24);
  const data = new DataView(png.buffer);
  data.setUint32(0, 0x89504e47); data.setUint32(4, 0x0d0a1a0a);
  data.setUint32(12, 0x49484452); data.setUint32(16, 1200); data.setUint32(20, 800);
  let encodedSize;
  const b = browser({ createImageBitmap: async () => {
    return { width: 800, height: 1200, close() {} };
  } });
  const createCanvas = b.context.document.createElement;
  b.context.document.createElement = () => {
    const canvas = createCanvas();
    const encode = canvas.toBlob;
    canvas.toBlob = (callback) => { encodedSize = [canvas.width, canvas.height]; encode(callback); };
    return canvas;
  };
  await b.api.compressImage(new Blob([png]));
  assert.deepEqual(encodedSize, [800, 1200]);
});
