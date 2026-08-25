import { HttpError } from "./http";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBSERVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface ObservationInput {
  requestId: string;
  studentNumber: number;
  studentName: string;
  observedAt: string;
  memo: string;
  photo: File;
}

function normalizeText(value: FormDataEntryValue | null, maximum: number, label: string) {
  if (typeof value !== "string") throw new HttpError(400, `${label} 값이 없습니다.`);
  const normalized = value.normalize("NFC").trim();
  if (/\p{Cc}/u.test(normalized)) throw new HttpError(400, `${label}에 사용할 수 없는 문자가 있습니다.`);
  if (Array.from(normalized).length > maximum) throw new HttpError(400, `${label}이 너무 깁니다.`);
  return normalized;
}

export function validateObservationForm(form: FormData): ObservationInput {
  const requestId = normalizeText(form.get("requestId"), 64, "요청 번호");
  if (!UUID_PATTERN.test(requestId)) throw new HttpError(400, "요청 번호 형식이 올바르지 않습니다.");

  const numberText = normalizeText(form.get("studentNumber"), 3, "학생 번호");
  const studentNumber = Number(numberText);
  if (!Number.isInteger(studentNumber) || studentNumber < 1 || studentNumber > 50) {
    throw new HttpError(400, "학생 번호는 1번부터 50번까지 입력해 주세요.");
  }

  const studentName = normalizeText(form.get("studentName"), 20, "학생 이름");
  if (Array.from(studentName).length < 2 || !/^[\p{L}\p{M} .'-]+$/u.test(studentName)) {
    throw new HttpError(400, "학생 이름을 올바르게 입력해 주세요.");
  }

  const observedAt = normalizeText(form.get("observedAt"), 16, "관찰 시각");
  if (!OBSERVED_AT_PATTERN.test(observedAt)) throw new HttpError(400, "관찰 날짜와 시간을 확인해 주세요.");
  const observedDate = new Date(`${observedAt}:00+09:00`);
  const earliest = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const latest = Date.now() + 2 * 24 * 60 * 60 * 1000;
  if (Number.isNaN(observedDate.getTime()) || observedDate.getTime() < earliest || observedDate.getTime() > latest) {
    throw new HttpError(400, "관찰 시각은 최근 90일 이내의 날짜로 입력해 주세요.");
  }

  const memo = normalizeText(form.get("memo") ?? "", 300, "관찰 기록");
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new HttpError(400, "달 사진을 선택해 주세요.");
  if (photo.size <= 0 || photo.size > 6 * 1024 * 1024) {
    throw new HttpError(413, "압축된 사진은 6MB 이하여야 합니다.");
  }

  return { requestId, studentNumber, studentName, observedAt, memo, photo };
}

export function detectImageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  throw new HttpError(415, "JPG, PNG 또는 WebP 사진만 제출할 수 있습니다.");
}

function concatenate(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function stripJpegMetadata(bytes: Uint8Array) {
  const parts: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      parts.push(bytes.slice(offset));
      break;
    }
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.slice(markerStart));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.slice(markerStart, offset));
      continue;
    }
    if (offset + 2 > bytes.length) throw new HttpError(415, "손상된 JPEG 사진입니다.");
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      throw new HttpError(415, "손상된 JPEG 사진입니다.");
    }
    const containsMetadata = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!containsMetadata) parts.push(bytes.slice(markerStart, segmentEnd));
    offset = segmentEnd;
  }
  return concatenate(parts);
}

function stripPngMetadata(bytes: Uint8Array) {
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  const removable = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new HttpError(415, "손상된 PNG 사진입니다.");
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (!removable.has(type)) parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return concatenate(parts);
}

function stripWebpMetadata(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const end = offset + 8 + length + (length % 2);
    if (end > bytes.length) throw new HttpError(415, "손상된 WebP 사진입니다.");
    if (type !== "EXIF" && type !== "XMP ") chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  const body = concatenate(chunks);
  const header = bytes.slice(0, 12);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  headerView.setUint32(4, body.byteLength + 4, true);
  return concatenate([header, body]);
}

export function stripImageMetadata(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/jpeg") return stripJpegMetadata(bytes);
  if (contentType === "image/png") return stripPngMetadata(bytes);
  if (contentType === "image/webp") return stripWebpMetadata(bytes);
  throw new HttpError(415, "지원하지 않는 사진 형식입니다.");
}

export function maskStudentName(name: string) {
  const characters = Array.from(name.trim());
  if (characters.length <= 1) return "학생";
  if (characters.length === 2) return `${characters[0]}○`;
  return `${characters[0]}${"○".repeat(characters.length - 2)}${characters.at(-1)}`;
}

export function encodeCursor(createdAt: string, id: string) {
  return btoa(JSON.stringify({ createdAt, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as {
      createdAt?: string;
      id?: string;
    };
    if (!parsed.createdAt || !parsed.id || !UUID_PATTERN.test(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
