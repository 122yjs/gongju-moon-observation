/* Client-only photo processing. No network, file contents, EXIF or form values are logged. */
(function (root) {
  'use strict';
  const VERSION = '2026-09-11.1';
  const LOG_KEY = 'moon-photo-pipeline-diagnostic-v1';
  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;
  const JPEG_MAX_PIXELS = 64 * 1000 * 1000;
  const OTHER_MAX_PIXELS = 16 * 1000 * 1000;
  const LOG_TTL = 24 * 60 * 60 * 1000;
  const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'NotSupportedError', 'InvalidStateError', 'EncodingError', 'SecurityError', 'NotReadableError', 'AbortError']);
  const STAGES = new Set(['header', 'decode', 'canvas', 'drawImage', 'toBlob', 'FormData', 'fetch', 'response', 'preview']);
  const META_KEYS = new Set(['width', 'height', 'bytes', 'status', 'elapsedMs', 'maxSide', 'maxPixels', 'attempt']);

  function isIOS(navigator = {}) {
    return /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
      (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
  }

  function fit(width, height, maxSide, maxPixels) {
    if (![width, height, maxSide, maxPixels].every(Number.isFinite) ||
        Math.min(width, height, maxSide, maxPixels) <= 0) throw new Error('사진 크기가 올바르지 않습니다.');
    const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }

  function photoError(code, stage) {
    const error = new Error(`사진 처리에 실패했습니다 (${stage}/${code}). 다른 사진을 선택하거나 진단 기록을 확인해 주세요.`);
    error.photoCode = code;
    error.photoStage = stage;
    return error;
  }

  function createDiagnostic(env) {
    const boot = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let events = [], pending = null, storageAvailable = true;
    try {
      const saved = JSON.parse(env.localStorage.getItem(LOG_KEY));
      if (saved && saved.version === VERSION && Array.isArray(saved.events)) {
        events = saved.events.filter(event => event && Number.isFinite(event.at) &&
          Date.now() - event.at >= 0 && Date.now() - event.at < LOG_TTL).slice(-100);
        if (saved.pending && Number.isFinite(saved.pending.at) &&
            Date.now() - saved.pending.at >= 0 && Date.now() - saved.pending.at < LOG_TTL) pending = saved.pending;
      }
    } catch (_) { storageAvailable = false; }
    const interrupted = pending ? { stage: STAGES.has(pending.stage) ? pending.stage : 'unknown', at: pending.at } : null;
    pending = null;

    function sanitize(meta = {}) {
      const result = {};
      for (const key of META_KEYS) if (Number.isFinite(meta[key]) && meta[key] >= 0) result[key] = meta[key];
      if (['image-element', 'image-bitmap'].includes(meta.backend)) result.backend = meta.backend;
      if (ERROR_NAMES.has(meta.errorName)) result.errorName = meta.errorName;
      if (typeof meta.code === 'string' && /^[A-Z_]{1,40}$/.test(meta.code)) result.code = meta.code;
      return result;
    }
    // Rebuild loaded entries as well: never export arbitrary content inserted into localStorage.
    events = events.filter(event => ['boot', 'start', 'ok', 'error', 'fallback'].includes(event.event))
      .map(event => ({ at: event.at, event: event.event, stage: STAGES.has(event.stage) ? event.stage : 'boot', ...sanitize(event) }));
    function persist() {
      try { env.localStorage.setItem(LOG_KEY, JSON.stringify({ version: VERSION, events, pending })); }
      catch (_) { storageAvailable = false; }
    }
    function record(event, stage, meta = {}) {
      const entry = { at: Date.now(), event, stage, ...sanitize(meta) };
      if (event === 'start') pending = { at: entry.at, stage, boot };
      if ((event === 'ok' || event === 'error') && pending && pending.stage === stage) pending = null;
      events = events.filter(item => entry.at - item.at < LOG_TTL).concat(entry).slice(-100);
      persist();
      if (event === 'error' && env.console && typeof env.console.warn === 'function') {
        env.console.warn('[MoonPhoto]', entry); // Deliberately never log raw errors or form/file data.
      }
    }
    async function step(stage, task, meta = {}) {
      const started = Date.now();
      record('start', stage, meta);
      try {
        const result = await task();
        record('ok', stage, { ...meta, elapsedMs: Date.now() - started,
          ...(stage === 'fetch' && result ? { status: result.status } : {}),
          ...(stage === 'header' && result ? { width: result.width, height: result.height } : {}) });
        return result;
      } catch (error) {
        record('error', stage, { ...meta, elapsedMs: Date.now() - started,
          errorName: ERROR_NAMES.has(error && error.name) ? error.name : 'Error',
          code: error && error.photoCode });
        try { if (error && typeof error === 'object' && !error.photoStage) error.photoStage = stage; } catch (_) { /* Frozen errors are rethrown unchanged. */ }
        throw error;
      }
    }
    function report() {
      return { version: VERSION, boot, storageAvailable, interrupted, pending,
        environment: { iosPath: isIOS(env.navigator), bitmapAvailable: typeof env.createImageBitmap === 'function' },
        events: events.filter(event => Date.now() - event.at < LOG_TTL).map(event => ({ ...event })) };
    }
    record('boot', 'boot');
    return { record, step, report };
  }

  function create(env = root, options = {}) {
    const diagnostic = createDiagnostic(env);
    const appleMobile = isIOS(env.navigator);
    const limits = appleMobile ? { maxSide: 2048, maxPixels: 3000000 } : { maxSide: 2560, maxPixels: 6553600 };
    const timeoutMs = options.timeoutMs || 30000;
    let processing = false;

    function release(source) {
      if (!source) return;
      try { source.release(); } catch (_) { /* Cleanup must not hide the processing failure. */ }
    }
    function disposeCanvas(canvas) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
    function imageElement(file) {
      return new Promise((resolve, reject) => {
        let img, url = '', timer;
        let settled = false;
        const cleanup = () => {
          env.clearTimeout(timer);
          if (img) { img.onload = null; img.onerror = null; img.removeAttribute('src'); }
          if (url) { env.URL.revokeObjectURL(url); url = ''; }
        };
        const fail = error => { if (!settled) { settled = true; cleanup(); reject(error); } };
        try {
          img = new env.Image();
          // onload avoids requesting an additional ImageBitmap/backing store. The engine
          // may still allocate original-size pixels; this is NOT a bounded native decoder.
          img.decoding = 'async';
          img.onload = () => {
            if (settled) return;
            if (!img.naturalWidth || !img.naturalHeight) { fail(photoError('EMPTY_IMAGE', 'decode')); return; }
            settled = true;
            env.clearTimeout(timer);
            img.onload = img.onerror = null;
            resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight, release: cleanup });
          };
          img.onerror = () => fail(photoError('IMAGE_LOAD_FAILED', 'decode'));
          timer = env.setTimeout(() => fail(photoError('IMAGE_LOAD_TIMEOUT', 'decode')), timeoutMs);
          url = env.URL.createObjectURL(file);
          img.src = url;
        } catch (error) { fail(error); }
      });
    }

    async function decode(file, dimensions) {
      // API presence is not a guarantee of working resize or a low-memory implementation.
      // iOS/iPadOS take the image-element path regardless of createImageBitmap presence.
      if (!appleMobile && typeof env.createImageBitmap === 'function') {
        try {
          return await diagnostic.step('decode', async () => {
            const target = fit(dimensions.width, dimensions.height, limits.maxSide, limits.maxPixels);
            const bitmap = await env.createImageBitmap(file, dimensions.jpeg ? {
              resizeWidth: target.width, resizeHeight: target.height,
              resizeQuality: 'high', imageOrientation: 'from-image'
            } : { imageOrientation: 'from-image' });
            if (!bitmap.width || !bitmap.height || (dimensions.jpeg &&
                (bitmap.width !== target.width || bitmap.height !== target.height))) {
              bitmap.close();
              throw photoError('BITMAP_RESIZE_IGNORED', 'decode');
            }
            return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
          }, { backend: 'image-bitmap' });
        } catch (error) {
          diagnostic.record('fallback', 'decode', { backend: 'image-element', code: error && error.photoCode });
        }
      }
      return diagnostic.step('decode', () => imageElement(file), { backend: 'image-element' });
    }

    function allocate(width, height) {
      let canvas;
      try {
        canvas = env.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw photoError('NO_CANVAS_CONTEXT', 'canvas');
        return { canvas, context };
      } catch (error) { disposeCanvas(canvas); throw error; }
    }
    function encode(canvas) {
      return diagnostic.step('toBlob', () => new Promise((resolve, reject) => {
        let settled = false;
        const done = (error, blob) => {
          if (settled) return;
          settled = true;
          env.clearTimeout(timer);
          if (error) reject(error); else resolve(blob);
        };
        const timer = env.setTimeout(() => done(photoError('ENCODE_TIMEOUT', 'toBlob')), timeoutMs);
        try {
          canvas.toBlob(blob => {
            if (!blob || !blob.size) done(photoError('EMPTY_BLOB', 'toBlob'));
            else if (blob.type !== 'image/jpeg') done(photoError('UNEXPECTED_BLOB_TYPE', 'toBlob'));
            else if (blob.size > MAX_OUTPUT_BYTES) done(photoError('OUTPUT_TOO_LARGE', 'toBlob'));
            else done(null, blob);
          }, 'image/jpeg', 0.9);
        } catch (error) { done(error); }
      }), { width: canvas.width, height: canvas.height });
    }

    async function compress(file, readDimensions) {
      if (processing) throw photoError('PHOTO_BUSY', 'decode');
      processing = true;
      let source, canvas, retryCanvas;
      try {
        const dimensions = await diagnostic.step('header', async () => {
          if (!file || !file.size || file.size > MAX_SOURCE_BYTES) throw photoError('SOURCE_SIZE', 'header');
          const value = await readDimensions(file);
          const maxPixels = value.jpeg ? JPEG_MAX_PIXELS : OTHER_MAX_PIXELS;
          if (!Number.isFinite(value.width) || !Number.isFinite(value.height) ||
              value.width <= 0 || value.height <= 0 || value.width * value.height > maxPixels) {
            throw photoError('SOURCE_PIXELS', 'header');
          }
          return value;
        }, { bytes: file && file.size });
        source = await decode(file, dimensions);
        const sourceLimit = dimensions.jpeg ? JPEG_MAX_PIXELS : OTHER_MAX_PIXELS;
        if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width * source.height > sourceLimit) {
          throw photoError('DECODED_PIXELS', 'decode');
        }
        // Use the decoder's oriented dimensions; do not rotate EXIF a second time.
        const target = fit(source.width, source.height, limits.maxSide, limits.maxPixels);
        const allocated = await diagnostic.step('canvas', () => allocate(target.width, target.height), { ...target, ...limits });
        canvas = allocated.canvas;
        await diagnostic.step('drawImage', () => {
          allocated.context.fillStyle = '#0b0e17';
          allocated.context.fillRect(0, 0, target.width, target.height);
          allocated.context.drawImage(source.image, 0, 0, target.width, target.height);
        }, target);
        release(source);
        source = null; // Release native image/bitmap before the encoder or preview runs.
        try { return await encode(canvas); }
        catch (error) {
          // A bounded, smaller retry from the already-downscaled canvas. No original
          // re-decode, no full-size intermediate canvas, no JPEG quality-only loop.
          if (!['EMPTY_BLOB', 'OUTPUT_TOO_LARGE'].includes(error && error.photoCode)) throw error;
          const smaller = fit(canvas.width, canvas.height, 1280, 1000000);
          diagnostic.record('fallback', 'toBlob', { ...smaller, attempt: 2 });
          const retry = await diagnostic.step('canvas', () => allocate(smaller.width, smaller.height), smaller);
          retryCanvas = retry.canvas;
          await diagnostic.step('drawImage', () => retry.context.drawImage(canvas, 0, 0, smaller.width, smaller.height), smaller);
          disposeCanvas(canvas);
          canvas = null;
          return await encode(retryCanvas);
        }
      } finally {
        release(source);
        disposeCanvas(canvas);
        disposeCanvas(retryCanvas);
        processing = false;
      }
    }

    // Preserve the existing API contract. No automatic retry: retain requestId at the
    // caller after an uncertain network outcome so a manual retry stays idempotent.
    async function send(values, blob, requestId) {
      const body = await diagnostic.step('FormData', () => {
        const form = new env.FormData();
        form.append('requestId', requestId);
        form.append('studentNumber', values.studentNumber);
        form.append('studentName', values.studentName.trim());
        form.append('observedAt', values.observedAt);
        form.append('memo', values.memo.trim());
        form.append('photo', blob, 'moon.jpg');
        return form;
      }, { bytes: blob.size });
      const response = await diagnostic.step('fetch', () => env.fetch('/api/observations', {
        method: 'POST', credentials: 'same-origin', body
      }));
      let result;
      try {
        result = await diagnostic.step('response', async () => {
          const json = await response.json();
          if (!json || typeof json !== 'object' || Array.isArray(json)) throw photoError('INVALID_RESPONSE', 'response');
          return json;
        }, { status: response.status });
      } catch (_) {
        if (response.ok) throw photoError('UPLOAD_RESULT_UNKNOWN', 'response');
        result = {};
      }
      if (!response.ok) diagnostic.record('error', 'fetch', { status: response.status, code: 'HTTP_ERROR' });
      return { response, result };
    }
    return { compress, send, diagnostic, limits };
  }
  root.MoonPhotoPipeline = Object.freeze({ version: VERSION, create, fit, isIOS });
})(globalThis);
