import { randomToken, safeSecretEqual, sha256Hex, toBase64Url, fromBase64Url } from "./crypto";
import { getEnv } from "./runtime";

const STUDENT_COOKIE = "moon_class_session";
const TEACHER_COOKIE = "moon_teacher_session";
const OPERATOR_COOKIE = "moon_operator_session";
const OAUTH_STATE_COOKIE = "moon_google_oauth_state";
const STUDENT_SESSION_MAX_AGE = 60 * 24 * 60 * 60;
const STUDENT_RESUME_MAX_AGE = 6 * 60 * 60;
const TEACHER_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const OPERATOR_SESSION_MAX_AGE = 12 * 60 * 60;
const OAUTH_STATE_MAX_AGE = 10 * 60;
const encoder = new TextEncoder();

export interface SessionPayload {
  role: "student" | "student-resume" | "teacher" | "operator";
  teacherId?: string;
  sid: string;
  exp: number;
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getEnv().SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
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
      !payload.sid ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      ((role === "student" || role === "student-resume" || role === "teacher") && !payload.teacherId)
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

function cookie(
  name: string,
  value: string,
  maxAge: number,
  options: { path?: string; sameSite?: "Lax" | "Strict" } = {},
) {
  return `${name}=${encodeURIComponent(value)}; Path=${options.path || "/"}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${options.sameSite || "Lax"}`;
}

export async function createStudentCookie(teacherId: string) {
  const value = await signSession({
    role: "student",
    teacherId,
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STUDENT_SESSION_MAX_AGE,
  });
  return cookie(STUDENT_COOKIE, value, STUDENT_SESSION_MAX_AGE);
}

export function createStudentResumeToken(teacherId: string) {
  return signSession({
    role: "student-resume",
    teacherId,
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STUDENT_RESUME_MAX_AGE,
  });
}

export async function createTeacherCookie(teacherId: string) {
  const value = await signSession({
    role: "teacher",
    teacherId,
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + TEACHER_SESSION_MAX_AGE,
  });
  return cookie(TEACHER_COOKIE, value, TEACHER_SESSION_MAX_AGE);
}

export async function createOperatorCookie() {
  const value = await signSession({
    role: "operator",
    sid: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + OPERATOR_SESSION_MAX_AGE,
  });
  return cookie(OPERATOR_COOKIE, value, OPERATOR_SESSION_MAX_AGE);
}

export function createOAuthStateCookie() {
  const state = randomToken(32);
  return {
    state,
    cookie: cookie(OAUTH_STATE_COOKIE, state, OAUTH_STATE_MAX_AGE, {
      path: "/api/google/callback",
      sameSite: "Lax",
    }),
  };
}

export function clearStudentCookie() {
  return cookie(STUDENT_COOKIE, "", 0);
}

export function clearTeacherCookie() {
  return cookie(TEACHER_COOKIE, "", 0);
}

export function clearOperatorCookie() {
  return cookie(OPERATOR_COOKIE, "", 0);
}

export function clearOAuthStateCookie() {
  return cookie(OAUTH_STATE_COOKIE, "", 0, { path: "/api/google/callback" });
}

export function getStudentSession(request: Request) {
  return verifySession(readCookie(request, STUDENT_COOKIE), "student");
}

export function getStudentResumeSession(value: string) {
  return verifySession(value, "student-resume");
}

export function getTeacherSession(request: Request) {
  return verifySession(readCookie(request, TEACHER_COOKIE), "teacher");
}

export function getOperatorSession(request: Request) {
  return verifySession(readCookie(request, OPERATOR_COOKIE), "operator");
}

export function getOAuthState(request: Request) {
  return readCookie(request, OAUTH_STATE_COOKIE);
}

export async function getViewerSession(request: Request) {
  return (await getTeacherSession(request)) || (await getStudentSession(request));
}

// 기존 파일에서 사용하던 이름을 유지합니다.
export const getAdminSession = getTeacherSession;
export const clearAdminCookie = clearTeacherCookie;
export function createAdminCookie(teacherId: string) {
  return createTeacherCookie(teacherId);
}

export { safeSecretEqual, sha256Hex };
