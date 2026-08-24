import { env } from "cloudflare:workers";

export interface AppEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  SESSION_SECRET: string;
  CLASS_INVITE_TOKEN: string;
  ADMIN_PASSWORD_HASH: string;
  CLASS_ID?: string;
  CLASS_LABEL?: string;
}

export function getEnv(): AppEnv {
  const runtime = env as unknown as Partial<AppEnv>;
  const required = [
    "DB",
    "BUCKET",
    "SESSION_SECRET",
    "CLASS_INVITE_TOKEN",
    "ADMIN_PASSWORD_HASH",
  ] as const;

  for (const key of required) {
    if (!runtime[key]) {
      throw new Error(`필수 서버 설정 ${key}가 없습니다.`);
    }
  }

  return runtime as AppEnv;
}

export function getClassId(runtime = getEnv()) {
  return runtime.CLASS_ID?.trim() || "gongju-4-1";
}

export function getClassLabel(runtime = getEnv()) {
  return runtime.CLASS_LABEL?.trim() || "4학년 1반";
}
