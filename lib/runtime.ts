import { env } from "cloudflare:workers";

export interface AppEnv {
  DB: D1Database;
  BUCKET?: R2Bucket;
  SESSION_SECRET: string;
  ADMIN_PASSWORD_HASH: string;
  CLASS_ID?: string;
  CLASS_LABEL?: string;
}

export function getEnv(): AppEnv {
  const runtime = env as unknown as Partial<AppEnv>;
  const required = ["DB", "SESSION_SECRET", "ADMIN_PASSWORD_HASH"] as const;

  for (const key of required) {
    if (!runtime[key]) {
      throw new Error(`필수 서버 설정 ${key}가 없습니다.`);
    }
  }

  return runtime as AppEnv;
}

// 기존 단일 학급 배포와의 호환을 위해 남겨 둡니다.
export function getClassId(runtime = getEnv()) {
  return runtime.CLASS_ID?.trim() || "legacy-gongju-4-1";
}

export function getClassLabel(runtime = getEnv()) {
  return runtime.CLASS_LABEL?.trim() || "우리 반";
}
