/* Real libjpeg-turbo/WASM verification. Run after building and generating fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', 'vendor', 'moon-jpeg-codec.js');
const fixtures = path.join(root, 'tests', 'fixtures');
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 8 * 1000 * 1000;

function requireFixture(name) {
  const filename = path.join(fixtures, name);
  assert.ok(fs.existsSync(filename), `missing generated fixture: ${name}`);
  return fs.readFileSync(filename);
}

function jpegInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset++) !== 0xff) break;
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9 || offset + 2 > view.byteLength) break;
    const length = view.getUint16(offset);
    const start = offset + 2;
    const end = offset + length;
    if (length < 2 || end > view.byteLength) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
      return { width: view.getUint16(start + 3), height: view.getUint16(start + 1), progressive: marker === 0xc2 };
    }
    offset = end;
  }
  throw new Error('fixture is not a readable JPEG');
}

function exifOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset++) !== 0xff) return 1;
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9 || offset + 2 > view.byteLength) return 1;
    const length = view.getUint16(offset);
    const start = offset + 2;
    const end = offset + length;
    if (length < 2 || end > view.byteLength) return 1;
    if (marker === 0xe1 && start + 14 <= end && view.getUint32(start) === 0x45786966 && view.getUint16(start + 4) === 0) {
      const tiff = start + 6;
      const byteOrder = view.getUint16(tiff);
      const little = byteOrder === 0x4949;
      if ((byteOrder !== 0x4949 && byteOrder !== 0x4d4d) || view.getUint16(tiff + 2, little) !== 42) return 1;
      const directory = tiff + view.getUint32(tiff + 4, little);
      if (directory < tiff + 8 || directory + 2 > end) return 1;
      const entries = view.getUint16(directory, little);
      for (let index = 0; index < entries; index += 1) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > end) return 1;
        if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
          return view.getUint16(entry + 8, little);
        }
      }
    }
    offset = end;
  }
  return 1;
}

async function loadCodec() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-codec-'));
  const modulePath = path.join(directory, 'moon-jpeg-codec.cjs');
  try {
    fs.copyFileSync(source, modulePath);
    const factory = require(modulePath);
    return { codec: await factory({ print() {}, printErr() {} }), directory };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function freeCodec(codec, pointer) {
  try { if (pointer) codec._free(pointer); } catch (_) {}
  try { codec._moon_release(); } catch (_) {}
}

async function decode(name, maxSide = 2560, orientation = 1) {
  const bytes = requireFixture(name);
  const { codec, directory } = await loadCodec();
  let pointer = 0;
  try {
    pointer = codec._malloc(bytes.length);
    assert.ok(pointer, 'input allocation must succeed');
    assert.ok(pointer + bytes.length <= codec.HEAPU8.byteLength, 'input allocation must stay inside the heap');
    codec.HEAPU8.set(bytes, pointer);
    return {
      codec,
      directory,
      pointer,
      status: codec._moon_decode(pointer, bytes.length, maxSide, orientation),
    };
  } catch (error) {
    freeCodec(codec, pointer);
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  assert.deepEqual(jpegInfo(requireFixture('original-5222x6024.jpg')), { width: 5222, height: 6024, progressive: false });
  assert.deepEqual(jpegInfo(requireFixture('crop-4015x4594.jpg')), { width: 4015, height: 4594, progressive: false });
  assert.deepEqual(jpegInfo(requireFixture('progressive-5222x6024.jpg')), { width: 5222, height: 6024, progressive: true });
  assert.equal(exifOrientation(requireFixture('oriented-320x480-o6.jpg')), 6, 'orientation fixture must contain EXIF orientation 6');

  if (!fs.existsSync(source)) {
    const message = 'Codec is not built. Run bash scripts/build_photo_codec.sh before native-codec verification.';
    if (process.env.MOON_REQUIRE_CODEC === '1') throw new Error(message);
    console.log(`codec verification skipped: ${message}`);
    return;
  }

  {
    const decoded = await decode('original-5222x6024.jpg');
    try {
      assert.equal(decoded.status, 0, '31MP baseline JPEG must decode');
      assert.equal(decoded.codec._moon_source_width(), 5222);
      assert.equal(decoded.codec._moon_source_height(), 6024);
      assert.equal(decoded.codec._moon_progressive(), 0);
      assert.ok(decoded.codec._moon_width() <= 2560 && decoded.codec._moon_height() <= 2560, 'reduced IDCT output must fit maxSide');
      assert.ok(decoded.codec._moon_width() * decoded.codec._moon_height() <= MAX_OUTPUT_PIXELS, 'output must be capped at 8MP');
      assert.equal(decoded.codec._moon_length(), decoded.codec._moon_width() * decoded.codec._moon_height() * 4, 'RGBA buffer must have exact length');
    } finally {
      freeCodec(decoded.codec, decoded.pointer);
      assert.equal(decoded.codec._moon_data(), 0, 'release must clear output pointer');
      assert.equal(decoded.codec._moon_length(), 0, 'release must clear output length');
      fs.rmSync(decoded.directory, { recursive: true, force: true });
    }
  }

  {
    const decoded = await decode('progressive-5222x6024.jpg');
    try {
      assert.equal(decoded.status, 0, 'bounded progressive JPEG must decode');
      assert.equal(decoded.codec._moon_progressive(), 1, 'codec must report progressive sources');
      assert.ok(decoded.codec._moon_width() * decoded.codec._moon_height() <= MAX_OUTPUT_PIXELS);
    } finally {
      freeCodec(decoded.codec, decoded.pointer);
      fs.rmSync(decoded.directory, { recursive: true, force: true });
    }
  }

  {
    const orientation = exifOrientation(requireFixture('oriented-320x480-o6.jpg'));
    assert.equal(orientation, 6, 'orientation fixture must contain EXIF orientation 6');
    const decoded = await decode('oriented-320x480-o6.jpg', 2560, orientation);
    try {
      assert.equal(decoded.status, 0, 'oriented JPEG must decode');
      assert.equal(decoded.codec._moon_source_width(), 320);
      assert.equal(decoded.codec._moon_source_height(), 480);
      assert.equal(decoded.codec._moon_width(), 480, 'EXIF orientation 6 must swap width');
      assert.equal(decoded.codec._moon_height(), 320, 'EXIF orientation 6 must swap height');
      assert.equal(decoded.codec._moon_length(), 480 * 320 * 4);
      assert.equal(decoded.codec._moon_orientation(), 6, 'codec must report the applied EXIF orientation');
    } finally {
      freeCodec(decoded.codec, decoded.pointer);
      fs.rmSync(decoded.directory, { recursive: true, force: true });
    }
  }

  {
    const { codec, directory } = await loadCodec();
    let pointer = 0;
    try {
      const invalid = new Uint8Array([0xff, 0xd8, 0x00, 0x00]);
      pointer = codec._malloc(invalid.length);
      assert.ok(pointer);
      codec.HEAPU8.set(invalid, pointer);
      assert.notEqual(codec._moon_decode(pointer, invalid.length, 2560, 1), 0, 'invalid JPEG must fail');
      assert.notEqual(codec._moon_decode(pointer, MAX_SOURCE_BYTES + 1, 2560, 1), 0, 'oversized source length must fail before decode');
      assert.equal(codec._moon_data(), 0, 'failed decode must not retain output state');
      assert.equal(codec._moon_length(), 0, 'failed decode must not retain output length');
    } finally {
      freeCodec(codec, pointer);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  console.log('codec verification passed');
}

main().catch((error) => {
  console.error(`codec verification failed: ${error.message}`);
  process.exitCode = 1;
});
