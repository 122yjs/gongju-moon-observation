import { getEnv } from "./runtime";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
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

async function encryptionKey(purpose: string) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${getEnv().SESSION_SECRET}\u0000${purpose}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(value: string, purpose: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(purpose), encoder.encode(value)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(encrypted)}`;
}

export async function decryptString(value: string, purpose: string) {
  const [version, ivText, encryptedText, extra] = value.split(".");
  if (version !== "v1" || !ivText || !encryptedText || extra) {
    throw new Error("암호화된 설정 형식이 올바르지 않습니다.");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivText) },
    await encryptionKey(purpose),
    fromBase64Url(encryptedText),
  );
  return decoder.decode(decrypted);
}
