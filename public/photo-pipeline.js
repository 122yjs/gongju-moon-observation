/* Local-only, bounded image preparation for the observation form. */
(() => {
  'use strict';

  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
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
    } catch (_) {
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
    return { maxSide, maxOutputBytes, quality, workerUrl: options.workerUrl || '/photo-worker.js' };
  }

  function readJpeg(view) {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    const end = Math.min(view.byteLength, 1024 * 1024);
    let orientation = 1;
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
        return { format: 'jpeg', width, height, displayWidth: sideways ? height : width, displayHeight: sideways ? width : height, orientation };
      }
      if (marker === 0xe1) orientation = readExifOrientation(view, start, segmentEnd) || orientation;
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
    }
    return width && height ? { format: 'webp', width, height, displayWidth: width, displayHeight: height, orientation: 1 } : null;
  }

  function imageInfo(buffer) {
    const view = new DataView(buffer);
    const info = readJpeg(view) || readPng(view) || readWebp(view);
    if (!info || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width * info.height > MAX_SOURCE_PIXELS) {
      throw problem('invalid-image');
    }
    return info;
  }

  async function inspect(file) {
    if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_SOURCE_BYTES || typeof file.arrayBuffer !== 'function') {
      throw problem('source-limit');
    }
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (_) {
      throw problem('source-limit');
    }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1 || buffer.byteLength > MAX_SOURCE_BYTES) throw problem('source-limit');
    return { buffer, info: imageInfo(buffer) };
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
    } catch (_) {
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
        } catch (_) {}
        if (url) {
          try { URL.revokeObjectURL(url); } catch (_) {}
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
      } catch (_) {
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
          try { worker.terminate(); } catch (_) {}
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
      } catch (_) {
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
      } catch (_) {
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
      const inspected = await inspect(file);
      input = inspected.buffer;
      const info = inspected.info;
      const pixels = info.width * info.height;
      if (info.format !== 'jpeg' && pixels > NATIVE_DECODE_PIXELS) throw problem('non-jpeg-limit');

      if (info.format === 'jpeg' && pixels > NATIVE_DECODE_PIXELS) {
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
      } else {
        input = null;
        source = await decodeNative(file, info, settings.maxSide);
        const width = source.source.width || source.source.naturalWidth;
        const height = source.source.height || source.source.naturalHeight;
        const finalSize = scaledDimensions(width, height, settings.maxSide);
        output = canvasOf(finalSize.width, finalSize.height);
        output.context.drawImage(source.source, 0, 0, output.canvas.width, output.canvas.height);
        source.release();
        source = null;
      }

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
