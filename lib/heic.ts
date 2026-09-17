const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
]);

const EXIF_DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function fourCc(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return "";
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function isHeicImage(bytes: Uint8Array) {
  if (bytes.byteLength < 16 || fourCc(bytes, 4) !== "ftyp") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(0, false);
  const end = declaredSize >= 16 ? Math.min(bytes.byteLength, declaredSize) : Math.min(bytes.byteLength, 256);
  if (end < 16) return false;

  if (HEIC_BRANDS.has(fourCc(bytes, 8))) return true;
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIC_BRANDS.has(fourCc(bytes, offset))) return true;
  }
  return false;
}

function normalizeExifDateTime(value: string) {
  const match = EXIF_DATE_PATTERN.exec(value);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return "";
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function directory(view: DataView, tiff: number, end: number, little: boolean, relativeOffset: number) {
  if (!Number.isSafeInteger(relativeOffset) || relativeOffset < 8) return null;
  const start = tiff + relativeOffset;
  if (start < tiff || start + 2 > end) return null;
  const entries = Math.min(view.getUint16(start, little), 256);
  if (start + 2 + entries * 12 > end) return null;
  return { start, entries };
}

function entry(view: DataView, info: { start: number; entries: number } | null, little: boolean, tag: number) {
  if (!info) return null;
  for (let index = 0; index < info.entries; index += 1) {
    const offset = info.start + 2 + index * 12;
    if (view.getUint16(offset, little) === tag) return offset;
  }
  return null;
}

function longValue(view: DataView, offset: number | null, end: number, little: boolean) {
  if (offset == null || offset + 12 > end || view.getUint32(offset + 4, little) !== 1) return null;
  const type = view.getUint16(offset + 2, little);
  if (type === 4) return view.getUint32(offset + 8, little);
  if (type === 3) return view.getUint16(offset + 8, little);
  return null;
}

function asciiValue(view: DataView, offset: number | null, tiff: number, end: number, little: boolean) {
  if (offset == null || offset + 12 > end || view.getUint16(offset + 2, little) !== 2) return "";
  const count = view.getUint32(offset + 4, little);
  if (!Number.isSafeInteger(count) || count < 2 || count > 128) return "";
  const start = count <= 4 ? offset + 8 : tiff + view.getUint32(offset + 8, little);
  if (start < tiff || start + count > end) return "";
  let value = "";
  for (let index = 0; index < count; index += 1) {
    const byte = view.getUint8(start + index);
    if (byte === 0) break;
    if (byte < 0x20 || byte > 0x7e) return "";
    value += String.fromCharCode(byte);
  }
  return value.trim();
}

function captureTimeFromTiff(view: DataView, tiff: number) {
  const end = view.byteLength;
  if (tiff < 0 || tiff + 8 > end) return "";
  const byteOrder = view.getUint16(tiff, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return "";
  const little = byteOrder === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return "";
  const ifd0 = directory(view, tiff, end, little, view.getUint32(tiff + 4, little));
  if (!ifd0) return "";

  const exifOffset = longValue(view, entry(view, ifd0, little, 0x8769), end, little);
  if (Number.isSafeInteger(exifOffset)) {
    const exifIfd = directory(view, tiff, end, little, exifOffset);
    const original = asciiValue(view, entry(view, exifIfd, little, 0x9003), tiff, end, little);
    const digitized = asciiValue(view, entry(view, exifIfd, little, 0x9004), tiff, end, little);
    const normalized = normalizeExifDateTime(original || digitized);
    if (normalized) return normalized;
  }

  return normalizeExifDateTime(asciiValue(view, entry(view, ifd0, little, 0x0132), tiff, end, little));
}

function findTiffCandidate(bytes: Uint8Array, marker: number, littleEndian: boolean) {
  let cursor = 0;
  let attempts = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (cursor + 4 <= bytes.byteLength && attempts < 64) {
    const offset = bytes.indexOf(marker, cursor);
    if (offset < 0 || offset + 4 > bytes.byteLength) break;
    const signatureMatches = littleEndian
      ? bytes[offset + 1] === 0x49 && bytes[offset + 2] === 0x2a && bytes[offset + 3] === 0x00
      : bytes[offset + 1] === 0x4d && bytes[offset + 2] === 0x00 && bytes[offset + 3] === 0x2a;
    if (signatureMatches) {
      attempts += 1;
      const value = captureTimeFromTiff(view, offset);
      if (value) return value;
    }
    cursor = offset + 1;
  }
  return "";
}

/**
 * HEIC stores EXIF as a HEIF metadata item. Its payload contains a normal TIFF
 * structure, so we locate bounded TIFF candidates and only accept a value from
 * the standard DateTimeOriginal/DateTimeDigitized/DateTime tags. File times are
 * deliberately not used as a fallback.
 */
export function readHeicCaptureTime(bytes: Uint8Array) {
  if (!isHeicImage(bytes)) return "";
  return findTiffCandidate(bytes, 0x49, true) || findTiffCandidate(bytes, 0x4d, false);
}
