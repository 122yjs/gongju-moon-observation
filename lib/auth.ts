import { getClassId, getEnv } from "./runtime";

const STUDENT_COOKIE = "moon_class_session";
const ADMIN_COOKIE = "moon_admin_session";
const encoder = new TextEncoder();

export interface SessionPayload {
  role: "student" | "admin";
  classId: string;
  sid: string;
  exp: number;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string) {
  const runtime = getEnv();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(runtime.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function safeSecretEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let mismatch = leftHash.length ^ rightHash.length;
  const length = Math.max(leftHash.length, rightHash.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function signSession(payload: SessionPayload) {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(encoded));
  return `${encoded}.${signature}`;
}

async function verifySession(value: string | null, role: SessionPayload["role"]) {
  if (!value) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = toBase64Url(await hmac(encoded));
  if (!(await safeSecretEqual(signature, expected))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (
      payload.role !== role ||
      payload.classId !== getClassId() ||
      !payload.sid ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function createStudentCookie() {
  const maxAge = 7 * 24 * 60 * 60;
  const value = await signSession({
    role: "student",
    classId: getClassId(),
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + maxAge,
  });
  return cookie(STUDENT_COOKIE, value, maxAge);
}

export async function createAdminCookie() {
  const maxAge = 12 * 60 * 60;
  const value = await signSession({
    role: "admin",
    classId: getClassId(),
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + maxAge,
  });
  return cookie(ADMIN_COOKIE, value, maxAge);
}

export function clearStudentCookie() {
  return cookie(STUDENT_COOKIE, "", 0);
}

export function clearAdminCookie() {
  return cookie(ADMIN_COOKIE, "", 0);
}

export function getStudentSession(request: Request) {
  return verifySession(readCookie(request, STUDENT_COOKIE), "student");
}

export function getAdminSession(request: Request) {
  return verifySession(readCookie(request, ADMIN_COOKIE), "admin");
}

export async function getViewerSession(request: Request) {
  return (await getAdminSession(request)) || (await getStudentSession(request));
}
