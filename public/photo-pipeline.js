/* Local-only, bounded image preparation for the observation form. */
(() => {
  'use strict';

  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const MAX_HEADER_BYTES = 1024 * 1024;
  const FILE_READ_TIMEOUT_MS = 30000;
  const MAX_SOURCE_PIXELS = 64 * 1000 * 1000;
  const NATIVE_DECODE_PIXELS = 16 * 1000 * 1000;
  const MAX_CANVAS_PIXELS = 8 * 1000 * 1000;
  const DEFAULT_MAX_SIDE = 2560;
  const DEFAULT_QUALITY = 0.9;
  const DEFAULT_OUTPUT_BYTES = 6 * 1024 * 1024;
  const DECODE_TIMEOUT_MS = 30000;
  const WORKER_TIMEOUT_MS = 45000;
  const ENCODE_TIMEOUT_MS = 30000;
  const DIAGNOSTIC_KEY = 'moon-photo-pipeline-v1';
  const DIAGNOSTIC_LIMIT = 40;

  const messages = {
    'source-limit': 'The source image exceeds the safe size limit.',
    'file-read-failed': 'The browser could not read the selected photo.',
    'file-read-timeout': 'The browser did not finish reading the selected photo.',
    'heic-convert-unavailable': 'The HEIC conversion service is unavailable.',
    'heic-convert-failed': 'The HEIC photo could not be converted.',
    'heic-convert-timeout': 'The HEIC conversion request timed out.',
    'heic-session-expired': 'A class session is required to convert HEIC photos.',
    'heic-output-invalid': 'The HEIC conversion service returned an invalid image.',
    'invalid-image': 'The selected file is not a supported image.',
    'non-jpeg-limit': 'High-resolution images must be JPEG files.',
    'metadata-mismatch': 'The supplied image metadata does not match the file.',
    'invalid-options': 'The image-processing options are invalid.',
    'bitmap-timeout': 'The browser image decoder timed out.',
    'image-decode-failed': 'The browser could not decode this image.',
    'image-decode-timeout': 'The browser image decoder timed out.',
    'canvas-limit': 'The output image dimensions exceed the safe limit.',
    'canvas-context': 'A canvas encoder is not available.',
    'worker-unavailable': 'The safe JPEG decoder is unavailable.',
    'worker-failed': 'The safe JPEG decoder stopped unexpectedly.',
    'worker-message-failed': 'The safe JPEG decoder returned an invalid response.',
    'worker-timeout': 'The safe JPEG decoder timed out.',
    'invalid-worker-output': 'The safe JPEG decoder returned an invalid image.',
    'target-limit': 'The requested JPEG output dimensions exceed the safe limit.',
    'encode-unavailable': 'A JPEG encoder is not available.',
    'encode-empty': 'The JPEG encoder returned no image.',
    'encode-failed': 'The JPEG encoder failed.',
    'encode-timeout': 'The JPEG encoder timed out.',
    'output-limit': 'The compressed image exceeds the output size limit.',
  };

  function problem(code) {
    const error = new Error(messages[code] || 'Image processing failed.');
    error.code = code;
    return error;
  }

  function record(stage, status, code) {
    // Only fixed pipeline labels and stable error codes are retained locally.
    try {
      const previous = JSON.parse(localStorage.getItem(DIAGNOSTIC_KEY) || '[]');
      const events = Array.isArray(previous) ? previous.slice(-DIAGNOSTIC_LIMIT + 1) : [];
      events.push({ at: Date.now(), stage, status, ...(code ? { code } : {}) });
      localStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify(events));
    } catch {
      // Diagnostics must never affect photo processing.
    }
  }

  function positiveInteger(value, fallback) {
    if (value === undefined) return fallback;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function optionsOf(options) {
    const maxSide = positiveInteger(options.maxSide, DEFAULT_MAX_SIDE);
    const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_OUTPUT_BYTES);
    const quality = options.quality === undefined ? DEFAULT_QUALITY : options.quality;
    if (!maxSide || !maxOutputBytes || typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) {
      throw problem('invalid-options');
    }
    if (options.workerUrl !== undefined && (typeof options.workerUrl !== 'string' || !options.workerUrl)) {
      throw problem('invalid-options');
    }
    if (options.heicUrl !== undefined && (typeof options.heicUrl !== 'string' || !options.heicUrl)) {
      throw problem('invalid-options');
    }
    return {
      maxSide,
      maxOutputBytes,
      quality,
      workerUrl: options.workerUrl || '/photo-worker.js',
      heicUrl: options.heicUrl || '/api/photos/heic',
      onProgress: options.onProgress,
      onMetadata: options.onMetadata,
    };
  }

  function readJpeg(view) {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    const end = Math.min(view.byteLength, 1024 * 1024);
    let orientation = 1;
    let capturedAt = '';
    while (offset + 4 <= end) {
      if (view.getUint8(offset++) !== 0xff) return null;
      while (offset < end && view.getUint8(offset) === 0xff) offset += 1;
      if (offset >= end) return null;
      const marker = view.getUint8(offset++);
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > end) return null;
      const length = view.getUint16(offset);
      const start = offset + 2;
      const segmentEnd = offset + length;
      if (length < 2 || segmentEnd > end) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return null;
        const height = view.getUint16(start + 1);
        const width = view.getUint16(start + 3);
        if (!width || !height) return null;
        const sideways = orientation >= 5 && orientation <= 8;
        return {
          format: 'jpeg',
          width,
          height,
          displayWidth: sideways ? height : width,
          displayHeight: sideways ? width : height,
          orientation,
          capturedAt: capturedAt || null,
        };
      }
      if (marker === 0xe1) {
        orientation = readExifOrientation(view, start, segmentEnd) || orientation;
        capturedAt = capturedAt || readExifCaptureTime(view, start, segmentEnd) || '';
      }
      offset = segmentEnd;
    }
    return null;
  }

  function readExifOrientation(view, start, end) {
    if (start + 14 > end || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return 1;
    const tiff = start + 6;
    const byteOrder = view.getUint16(tiff);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1;
    const little = byteOrder === 0x4949;
    if (tiff + 8 > end || view.getUint16(tiff + 2, little) !== 42) return 1;
    const directory = tiff + view.getUint32(tiff + 4, little);
    if (directory < tiff + 8 || directory + 2 > end) return 1;
    const entries = Math.min(view.getUint16(directory, little), 256);
    for (let index = 0; index < entries; index += 1) {
      const entry = directory + 2 + index * 12;
      if (entry + 12 > end) break;
      if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
        const orientation = view.getUint16(entry + 8, little);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    return 1;
  }

  function exifDirectory(view, tiff, end, little, relativeOffset) {
    const directory = tiff + relativeOffset;
    if (directory < tiff + 8 || directory + 2 > end) return null;
    const entries = Math.min(view.getUint16(directory, little), 256);
    if (directory + 2 + entries * 12 > end) return null;
    return { directory, entries };
  }

  function findExifEntry(view, directoryInfo, little, tag) {
    if (!directoryInfo) return null;
    for (let index = 0; index < directoryInfo.entries; index += 1) {
      const entry = directoryInfo.directory + 2 + index * 12;
      if (view.getUint16(entry, little) === tag) return entry;
    }
    return null;
  }

  function exifAscii(view, entry, tiff, end, little) {
    if (entry == null || entry + 12 > end || view.getUint16(entry + 2, little) !== 2) return '';
    const count = view.getUint32(entry + 4, little);
    if (!Number.isSafeInteger(count) || count < 2 || count > 128) return '';
    const offset = count <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little);
    if (offset < tiff || offset + count > end) return '';
    let value = '';
    for (let index = 0; index < count; index += 1) {
      const byte = view.getUint8(offset + index);
      if (byte === 0) break;
      if (byte < 0x20 || byte > 0x7e) return '';
      value += String.fromCharCode(byte);
    }
    return value.trim();
  }

  function exifLong(view, entry, end, little) {
    if (entry == null || entry + 12 > end) return null;
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    if (count !== 1) return null;
    if (type === 4) return view.getUint32(entry + 8, little);
    if (type === 3) return view.getUint16(entry + 8, little);
    return null;
  }

  function normalizeExifDateTime(value) {
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return '';
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) return '';
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  }

  function readExifCaptureTime(view, start, end) {
    if (start + 14 > end || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return '';
    const tiff = start + 6;
    const byteOrder = view.getUint16(tiff);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return '';
    const little = byteOrder === 0x4949;
    if (tiff + 8 > end || view.getUint16(tiff + 2, little) !== 42) return '';
    const ifd0 = exifDirectory(view, tiff, end, little, view.getUint32(tiff + 4, little));
    if (!ifd0) return '';

    const exifOffset = exifLong(view, findExifEntry(view, ifd0, little, 0x8769), end, little);
    if (Number.isSafeInteger(exifOffset)) {
      const exifIfd = exifDirectory(view, tiff, end, little, exifOffset);
      const original = exifAscii(view, findExifEntry(view, exifIfd, little, 0x9003), tiff, end, little);
      const digitized = exifAscii(view, findExifEntry(view, exifIfd, little, 0x9004), tiff, end, little);
      const normalized = normalizeExifDateTime(original || digitized);
      if (normalized) return normalized;
    }

    return normalizeExifDateTime(exifAscii(view, findExifEntry(view, ifd0, little, 0x0132), tiff, end, little));
  }

  function readPng(view) {
    if (view.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(12) !== 0x49484452) return null;
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width && height ? { format: 'png', width, height, displayWidth: width, displayHeight: height, orientation: 1 } : null;
  }

  function readWebp(view) {
    if (view.byteLength < 30 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null;
    const chunk = view.getUint32(12);
    let width;
    let height;
    if (chunk === 0x56503858) {
      width = 1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16);
      height = 1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16);
    } else if (chunk === 0x56503820 && view.getUint8(23) === 0x9d && view.getUint8(24) === 0x01 && view.getUint8(25) === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 0x5650384c && view.getUint8(20) === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    return width && height ? { format: 'webp', width, height, displayWidth: width, displayHeight: height, orientation: 1 } : null;
  }

  function imageInfo(buffer) {
    const view = new DataView(buffer);
    // Identify the container, not the extension or picker-supplied MIME type.
    if (view.byteLength >= 16 && view.getUint32(4) === 0x66747970) {
      const end = Math.min(view.byteLength, view.getUint32(0), 256);
      const heifBrands = new Set([0x68656963, 0x68656978, 0x68657663, 0x68657678, 0x6865696d, 0x68656973]);
      for (let offset = 8; offset + 4 <= end; offset += 4) {
        if (offset !== 12 && heifBrands.has(view.getUint32(offset))) return { format: 'heic' };
      }
    }
    const info = readJpeg(view) || readPng(view) || readWebp(view);
    if (!info || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width * info.height > MAX_SOURCE_PIXELS) {
      throw problem('invalid-image');
    }
    return info;
  }

  function validCapturedAt(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : '';
  }

  async function convertHeic(file, settings) {
    if (typeof fetch !== 'function') throw problem('heic-convert-unavailable');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    try {
      if (controller) timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
      progress(settings, 'converting');
      const response = await fetch(settings.heicUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response || !response.ok) {
        if (response && response.status === 401) throw problem('heic-session-expired');
        if (response && response.status === 413) throw problem('source-limit');
        throw problem('heic-convert-failed');
      }
      const contentType = String(response.headers?.get?.('Content-Type') || '').toLowerCase();
      if (!contentType.startsWith('image/jpeg') || typeof response.blob !== 'function') throw problem('heic-output-invalid');
      const blob = await response.blob();
      if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || blob.size < 1) throw problem('heic-output-invalid');
      if (blob.size > settings.maxOutputBytes) throw problem('output-limit');
      return {
        blob,
        capturedAt: validCapturedAt(response.headers?.get?.('X-Photo-Captured-At') || ''),
      };
    } catch (error) {
      if (controller && controller.signal.aborted) throw problem('heic-convert-timeout');
      if (error && error.code) throw error;
      throw problem('heic-convert-failed');
    } finally {
      clearTimeout(timer);
    }
  }

  function readBytes(file, maximum) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(problem('file-read-timeout')), FILE_READ_TIMEOUT_MS);
      function finish(error, buffer) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(buffer);
      }
      // A cloud-backed picker may never complete arrayBuffer(). Late results are
      // discarded; importantly, they must not start another decoder after timeout.
      Promise.resolve().then(() => file.arrayBuffer()).then((buffer) => {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1 || buffer.byteLength > maximum || buffer.byteLength !== file.size) {
          finish(problem('file-read-failed'));
        } else {
          finish(null, buffer);
        }
      }, () => finish(problem('file-read-failed')));
    });
  }

  async function inspect(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SOURCE_BYTES || typeof file.arrayBuffer !== 'function' || typeof file.slice !== 'function') {
      throw problem('source-limit');
    }
    // Native decoding needs only a bounded header, not an extra full-file copy.
    return imageInfo(await readBytes(file.slice(0, MAX_HEADER_BYTES), MAX_HEADER_BYTES));
  }

  function progress(settings, stage) {
    try { if (typeof settings.onProgress === 'function') settings.onProgress(stage); } catch {}
  }

  function scaledDimensions(width, height, maxSide) {
    const factor = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    const scaledWidth = Math.max(1, Math.round(width * factor));
    const scaledHeight = Math.max(1, Math.round(height * factor));
    if (scaledWidth * scaledHeight > MAX_CANVAS_PIXELS) throw problem('canvas-limit');
    return { width: scaledWidth, height: scaledHeight };
  }

  function canvasOf(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_CANVAS_PIXELS) {
      throw problem('canvas-limit');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let context;
    try {
      context = canvas.getContext('2d');
    } catch {
      canvas.width = 0;
      canvas.height = 0;
      throw problem('canvas-context');
    }
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      throw problem('canvas-context');
    }
    return { canvas, context };
  }

  function clearCanvas(item) {
    if (!item) return;
    item.canvas.width = 0;
    item.canvas.height = 0;
  }

  function bitmapWithTimeout(file, options) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(problem('bitmap-timeout')), DECODE_TIMEOUT_MS);
      function finish(error, bitmap) {
        if (settled) {
          if (bitmap && typeof bitmap.close === 'function') bitmap.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(bitmap);
      }
      Promise.resolve().then(() => createImageBitmap(file, options)).then(
        (bitmap) => finish(null, bitmap),
        () => finish(problem('image-decode-failed')),
      );
    });
  }

  function htmlImage(file) {
    return new Promise((resolve, reject) => {
      if (typeof Image !== 'function' || !URL || typeof URL.createObjectURL !== 'function') {
        reject(problem('image-decode-failed'));
        return;
      }
      const image = new Image();
      let url;
      let settled = false;
      let timer;
      const release = () => {
        image.onload = null;
        image.onerror = null;
        try {
          if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
          else image.src = '';
        } catch {}
        if (url) {
          try { URL.revokeObjectURL(url); } catch {}
          url = null;
        }
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          release();
          reject(error);
        } else {
          resolve({ source: image, release });
        }
      };
      try {
        url = URL.createObjectURL(file);
        timer = setTimeout(() => finish(problem('image-decode-timeout')), DECODE_TIMEOUT_MS);
        image.onload = () => {
          if (!image.naturalWidth || !image.naturalHeight) finish(problem('image-decode-failed'));
          else finish();
        };
        image.onerror = () => finish(problem('image-decode-failed'));
        image.decoding = 'async';
        image.src = url;
      } catch {
        finish(problem('image-decode-failed'));
      }
    });
  }

  async function decodeNative(file, info, maxSide) {
    const dimensions = scaledDimensions(info.displayWidth, info.displayHeight, maxSide);
    if (typeof createImageBitmap === 'function') {
      const bitmapOptions = info.format === 'jpeg'
        ? { resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: 'high', imageOrientation: 'from-image' }
        : { resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: 'high' };
      try {
        const bitmap = await bitmapWithTimeout(file, bitmapOptions);
        return { source: bitmap, release: () => { if (typeof bitmap.close === 'function') bitmap.close(); } };
      } catch (error) {
        if (error && error.code === 'bitmap-timeout') throw error;
        record('decode-fallback', 'selected');
      }
    }
    return htmlImage(file);
  }

  function workerDecode(buffer, maxSide, workerUrl) {
    return new Promise((resolve, reject) => {
      if (typeof Worker !== 'function') {
        reject(problem('worker-unavailable'));
        return;
      }
      let worker;
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (worker) {
          try { worker.terminate(); } catch {}
        }
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(problem('worker-timeout')), WORKER_TIMEOUT_MS);
      try {
        worker = new Worker(workerUrl);
        worker.onerror = () => finish(problem('worker-failed'));
        worker.onmessageerror = () => finish(problem('worker-message-failed'));
        worker.onmessage = ({ data }) => {
          if (!data || typeof data !== 'object') return finish(problem('worker-message-failed'));
          if (data.type === 'error') return finish(problem(typeof data.code === 'string' ? data.code : 'worker-failed'));
          if (data.type !== 'decoded') return finish(problem('worker-message-failed'));
          const rgba = data.rgba || data.buffer;
          if (!Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1 || data.width * data.height > MAX_CANVAS_PIXELS || !(rgba instanceof ArrayBuffer) || rgba.byteLength !== data.width * data.height * 4) {
            return finish(problem('invalid-worker-output'));
          }
          finish(null, { width: data.width, height: data.height, rgba });
        };
        worker.postMessage({ type: 'decode', maxSide, buffer }, [buffer]);
      } catch {
        finish(problem('worker-unavailable'));
      }
    });
  }

  function encode(canvas, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        reject(problem('encode-unavailable'));
        return;
      }
      let done = false;
      const timer = setTimeout(() => finish(problem('encode-timeout')), ENCODE_TIMEOUT_MS);
      const finish = (error, blob) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(blob);
      };
      try {
        canvas.toBlob((blob) => {
          if (!blob) return finish(problem('encode-empty'));
          if (blob.type !== 'image/jpeg') return finish(problem('encode-failed'));
          finish(null, blob);
        }, 'image/jpeg', quality);
      } catch {
        finish(problem('encode-failed'));
      }
    });
  }

  async function compress(file, suppliedOptions = {}) {
    const options = suppliedOptions && typeof suppliedOptions === 'object' ? suppliedOptions : {};
    const settings = optionsOf(options);
    record('compress', 'start');
    let input;
    let source;
    let scratch;
    let output;
    try {
      progress(settings, 'reading');
      const info = await inspect(file);
      if (info.format === 'heic') {
        record('convert-heic', 'start');
        const converted = await convertHeic(file, settings);
        try {
          if (typeof settings.onMetadata === 'function') {
            settings.onMetadata({ format: 'heic', capturedAt: converted.capturedAt || null });
          }
        } catch {
          // Metadata hints are optional and must never break image preparation.
        }
        record('convert-heic', 'success');
        record('compress', 'success');
        return converted.blob;
      }
      try {
        if (typeof settings.onMetadata === 'function') {
          settings.onMetadata({ format: info.format, capturedAt: info.capturedAt || null });
        }
      } catch {
        // Metadata hints are optional and must never break image preparation.
      }
      const pixels = info.width * info.height;
      if (info.format !== 'jpeg' && pixels > NATIVE_DECODE_PIXELS) throw problem('non-jpeg-limit');

      if (info.format === 'jpeg' && pixels > NATIVE_DECODE_PIXELS) {
        input = await readBytes(file, MAX_SOURCE_BYTES);
        progress(settings, 'decoding');
        record('decode-worker', 'start');
        const reduced = await workerDecode(input, settings.maxSide, settings.workerUrl);
        input = null; // Ownership transferred to the worker.
        const finalSize = scaledDimensions(reduced.width, reduced.height, settings.maxSide);
        if (finalSize.width === reduced.width && finalSize.height === reduced.height) {
          output = canvasOf(reduced.width, reduced.height);
          output.context.putImageData(new ImageData(new Uint8ClampedArray(reduced.rgba), reduced.width, reduced.height), 0, 0);
        } else {
          scratch = canvasOf(reduced.width, reduced.height);
          scratch.context.putImageData(new ImageData(new Uint8ClampedArray(reduced.rgba), reduced.width, reduced.height), 0, 0);
          output = canvasOf(finalSize.width, finalSize.height);
          output.context.drawImage(scratch.canvas, 0, 0, output.canvas.width, output.canvas.height);
          clearCanvas(scratch);
          scratch = null;
        }
        reduced.rgba = null;
      } else {
        progress(settings, 'decoding');
        source = await decodeNative(file, info, settings.maxSide);
        const width = source.source.width || source.source.naturalWidth;
        const height = source.source.height || source.source.naturalHeight;
        const finalSize = scaledDimensions(width, height, settings.maxSide);
        output = canvasOf(finalSize.width, finalSize.height);
        output.context.drawImage(source.source, 0, 0, output.canvas.width, output.canvas.height);
        source.release();
        source = null;
      }

      progress(settings, 'encoding');
      const blob = await encode(output.canvas, settings.quality);
      if (blob.size > settings.maxOutputBytes) throw problem('output-limit');
      record('compress', 'success');
      return blob;
    } catch (error) {
      const safeCode = error && typeof error.code === 'string' && /^[a-z-]{3,40}$/.test(error.code) ? error.code : 'processing-failed';
      record('compress', 'error', safeCode);
      if (error && error.code) throw error;
      throw problem('encode-failed');
    } finally {
      if (source) source.release();
      clearCanvas(scratch);
      clearCanvas(output);
      input = null;
    }
  }

  globalThis.MoonPhotoPipeline = Object.freeze({ compress });
})();
