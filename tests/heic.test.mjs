import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../lib/heic.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
runInNewContext(source, { exports, DataView, Uint8Array, Set, String, Date, Number });

function heicWithExif(capturedAt = '2026:09:16 20:10:22') {
  const ftyp = new Uint8Array(24);
  const ftypView = new DataView(ftyp.buffer);
  ftypView.setUint32(0, 24, false);
  ftyp.set([0x66, 0x74, 0x79, 0x70], 4);
  ftyp.set([0x68, 0x65, 0x69, 0x63], 8);
  ftypView.setUint32(12, 0, false);
  ftyp.set([0x6d, 0x69, 0x66, 0x31], 16);
  ftyp.set([0x68, 0x65, 0x69, 0x63], 20);

  const tiff = new Uint8Array(72);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 0x9003, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, 20, true);
  view.setUint32(36, 44, true);
  view.setUint32(40, 0, true);
  [...capturedAt, '\0'].forEach((character, index) => { tiff[44 + index] = character.charCodeAt(0); });

  const bytes = new Uint8Array(ftyp.byteLength + 8 + tiff.byteLength);
  bytes.set(ftyp, 0);
  bytes.set([0x00, 0x00, 0x00, 0x00, 0x45, 0x78, 0x69, 0x66], ftyp.byteLength);
  bytes.set(tiff, ftyp.byteLength + 8);
  return bytes;
}

test('recognizes HEIC-compatible brands without trusting the file extension', () => {
  assert.equal(exports.isHeicImage(heicWithExif()), true);
  const genericHeif = heicWithExif();
  genericHeif.set([0x6d, 0x69, 0x66, 0x31], 8);
  genericHeif.set([0x6d, 0x69, 0x66, 0x31], 20);
  assert.equal(exports.isHeicImage(genericHeif), false);
});

test('reads DateTimeOriginal from HEIC EXIF without using file modification time as a fallback', () => {
  assert.equal(exports.readHeicCaptureTime(heicWithExif()), '2026-09-16T20:10');
  assert.equal(exports.readHeicCaptureTime(heicWithExif('not-a-photo-time')), '');
});

test('recognizes a real HEIC file produced by the macOS image codec', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/sample-generated.heic', import.meta.url)));
  assert.equal(exports.isHeicImage(bytes), true);
  assert.equal(exports.readHeicCaptureTime(bytes), '');
});
