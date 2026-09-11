'use strict';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 64 * 1000 * 1000;
const MAX_RGBA_PIXELS = 8 * 1000 * 1000;
let busy = false;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function orientationOf(buffer) {
  const view = new DataView(buffer);
  const end = Math.min(view.byteLength, 1024 * 1024);
  if (end < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= end) {
    if (view.getUint8(offset++) !== 0xff) return 1;
    while (offset < end && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= end) return 1;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9) return 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > end) return 1;
    const length = view.getUint16(offset);
    const start = offset + 2;
    const segmentEnd = offset + length;
    if (length < 2 || segmentEnd > end) return 1;
    if (marker === 0xe1 && start + 14 <= segmentEnd && view.getUint32(start) === 0x45786966 && view.getUint16(start + 4) === 0) {
      const tiff = start + 6;
      const order = view.getUint16(tiff);
      if (order !== 0x4949 && order !== 0x4d4d) return 1;
      const little = order === 0x4949;
      if (tiff + 8 > segmentEnd || view.getUint16(tiff + 2, little) !== 42) return 1;
      const directory = tiff + view.getUint32(tiff + 4, little);
      if (directory < tiff + 8 || directory + 2 > segmentEnd) return 1;
      const count = Math.min(view.getUint16(directory, little), 256);
      for (let index = 0; index < count; index += 1) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > segmentEnd) break;
        if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
    }
    offset = segmentEnd;
  }
  return 1;
}

function jpegDimensions(buffer) {
  const view = new DataView(buffer);
  const end = Math.min(view.byteLength, 1024 * 1024);
  if (end < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= end) {
    if (view.getUint8(offset++) !== 0xff) return null;
    while (offset < end && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= end) return null;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9) return null;
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
      return width && height ? { width, height } : null;
    }
    offset = segmentEnd;
  }
  return null;
}

function safeTargetDimensions(source, maxSide) {
  if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width * source.height > MAX_SOURCE_PIXELS) {
    throw failure('source-limit');
  }
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > MAX_RGBA_PIXELS) throw failure('target-limit');
}

function validCodec(codec) {
  return codec && codec.HEAPU8 instanceof Uint8Array && ['_malloc', '_free', '_moon_decode', '_moon_width', '_moon_height', '_moon_length', '_moon_data', '_moon_release'].every((name) => typeof codec[name] === 'function');
}

self.onmessage = async ({ data }) => {
  if (busy || !data || data.type !== 'decode') return;
  busy = true;
  let codec;
  let input = 0;
  try {
    if (!(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength < 1 || data.buffer.byteLength > MAX_SOURCE_BYTES) throw failure('source-limit');
    if (!Number.isSafeInteger(data.maxSide) || data.maxSide < 1) throw failure('invalid-options');
    const source = jpegDimensions(data.buffer);
    if (!source) throw failure('invalid-jpeg');
    safeTargetDimensions(source, data.maxSide);
    importScripts('./vendor/moon-jpeg-codec.js');
    if (typeof createMoonJpegCodec !== 'function') throw failure('codec-unavailable');
    codec = await createMoonJpegCodec({ print() {}, printErr() {} });
    if (!validCodec(codec)) throw failure('codec-unavailable');
    input = codec._malloc(data.buffer.byteLength);
    if (!input) throw failure('memory-limit');
    if (input < 0 || input + data.buffer.byteLength > codec.HEAPU8.byteLength) throw failure('memory-limit');
    codec.HEAPU8.set(new Uint8Array(data.buffer), input);
    const status = codec._moon_decode(input, data.buffer.byteLength, data.maxSide, orientationOf(data.buffer));
    if (status !== 0) {
      const codes = { 1: 'invalid-jpeg', 2: 'source-limit', 3: 'memory-limit', 4: 'decode-failed' };
      throw failure(codes[status] || 'decode-failed');
    }
    const width = codec._moon_width();
    const height = codec._moon_height();
    const length = codec._moon_length();
    const pointer = codec._moon_data();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(length) || !Number.isSafeInteger(pointer) || width < 1 || height < 1 || width * height > MAX_RGBA_PIXELS || length !== width * height * 4 || pointer < 0 || pointer + length > codec.HEAPU8.byteLength) {
      throw failure('invalid-output');
    }
    const rgba = codec.HEAPU8.slice(pointer, pointer + length);
    self.postMessage({ type: 'decoded', width, height, rgba: rgba.buffer }, [rgba.buffer]);
  } catch (error) {
    const allowed = new Set(['source-limit', 'target-limit', 'invalid-options', 'codec-unavailable', 'memory-limit', 'invalid-jpeg', 'decode-failed', 'invalid-output']);
    self.postMessage({ type: 'error', code: allowed.has(error && error.code) ? error.code : 'codec-unavailable' });
  } finally {
    if (codec) {
      try { if (input) codec._free(input); } catch (_) {}
      try { codec._moon_release(); } catch (_) {}
    }
    busy = false;
    self.close();
  }
};
