import { decryptString, encryptString } from "./crypto";
import { HttpError } from "./http";
import { getEnv } from "./runtime";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  updatedAt: string;
}

export interface TeacherConnection {
  id: string;
  googlePermissionId: string;
  googleEmail: string;
  googleDisplayName: string;
  refreshTokenCiphertext: string;
  accessTokenCiphertext: string | null;
  accessTokenExpiresAt: string | null;
  rootFolderId: string;
  photosFolderId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  inviteTokenHash: string;
  inviteTokenCiphertext: string;
  classLabel: string;
  createdAt: string;
  updatedAt: string;
}

interface OAuthConfigRow {
  client_id: string;
  client_secret_ciphertext: string;
  updated_at: string;
}

interface TeacherRow {
  id: string;
  google_permission_id: string;
  google_email: string;
  google_display_name: string;
  refresh_token_ciphertext: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  root_folder_id: string;
  photos_folder_id: string;
  spreadsheet_id: string;
  sheet_id: number;
  sheet_title: string;
  invite_token_hash: string;
  invite_token_ciphertext: string;
  class_label: string;
  created_at: string;
  updated_at: string;
}

function mapTeacher(row: TeacherRow): TeacherConnection {
  return {
    id: row.id,
    googlePermissionId: row.google_permission_id,
    googleEmail: row.google_email,
    googleDisplayName: row.google_display_name,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    accessTokenCiphertext: row.access_token_ciphertext,
    accessTokenExpiresAt: row.access_token_expires_at,
    rootFolderId: row.root_folder_id,
    photosFolderId: row.photos_folder_id,
    spreadsheetId: row.spreadsheet_id,
    sheetId: Number(row.sheet_id || 0),
    sheetTitle: row.sheet_title || "관찰 기록",
    inviteTokenHash: row.invite_token_hash,
    inviteTokenCiphertext: row.invite_token_ciphertext,
    classLabel: row.class_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOAuthConfig(): Promise<OAuthConfig | null> {
  const row = await getEnv().DB.prepare(
    "SELECT client_id, client_secret_ciphertext, updated_at FROM oauth_config WHERE id = 'google' LIMIT 1",
  ).first<OAuthConfigRow>();
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientSecret: await decryptString(row.client_secret_ciphertext, "google-oauth-client-secret"),
    updatedAt: row.updated_at,
  };
}

export async function requireOAuthConfig() {
  const config = await getOAuthConfig();
  if (!config) {
    throw new HttpError(503, "서비스 운영자가 Google OAuth 연결을 아직 설정하지 않았습니다.");
  }
  return config;
}

export async function saveOAuthConfig(clientId: string, clientSecret: string) {
  const normalizedId = clientId.trim();
  const normalizedSecret = clientSecret.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(normalizedId) || normalizedId.length > 256) {
    throw new HttpError(400, "Google OAuth 클라이언트 ID 형식을 확인해 주세요.");
  }
  if (normalizedSecret.length < 12 || normalizedSecret.length > 512) {
    throw new HttpError(400, "Google OAuth 클라이언트 보안 비밀번호를 확인해 주세요.");
  }
  const encrypted = await encryptString(normalizedSecret, "google-oauth-client-secret");
  const now = new Date().toISOString();
  await getEnv().DB.prepare(
    `INSERT INTO oauth_config (id, client_id, client_secret_ciphertext, created_at, updated_at)
     VALUES ('google', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       client_id = excluded.client_id,
       client_secret_ciphertext = excluded.client_secret_ciphertext,
       updated_at = excluded.updated_at`,
  )
    .bind(normalizedId, encrypted, now, now)
    .run();
}

async function findTeacher(where: string, value: string) {
  const row = await getEnv().DB.prepare(
    `SELECT * FROM teacher_connections WHERE ${where} = ? LIMIT 1`,
  )
    .bind(value)
    .first<TeacherRow>();
  return row ? mapTeacher(row) : null;
}

export function getTeacherById(id: string) {
  return findTeacher("id", id);
}

export function getTeacherByGooglePermissionId(permissionId: string) {
  return findTeacher("google_permission_id", permissionId);
}

export function getTeacherByInviteHash(hash: string) {
  return findTeacher("invite_token_hash", hash);
}

export async function createTeacherConnection(input: {
  googlePermissionId: string;
  googleEmail: string;
  googleDisplayName: string;
  refreshToken: string;
  rootFolderId: string;
  photosFolderId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  inviteToken: string;
  inviteTokenHash: string;
  classLabel: string;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const refreshTokenCiphertext = await encryptString(input.refreshToken, `google-refresh-token:${id}`);
  const inviteTokenCiphertext = await encryptString(input.inviteToken, `class-invite-token:${id}`);
  await getEnv().DB.prepare(
    `INSERT INTO teacher_connections (
       id, google_permission_id, google_email, google_display_name,
       refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at,
       root_folder_id, photos_folder_id, spreadsheet_id, sheet_id, sheet_title,
       invite_token_hash, invite_token_ciphertext, class_label, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.googlePermissionId,
      input.googleEmail,
      input.googleDisplayName,
      refreshTokenCiphertext,
      input.rootFolderId,
      input.photosFolderId,
      input.spreadsheetId,
      input.sheetId,
      input.sheetTitle,
      input.inviteTokenHash,
      inviteTokenCiphertext,
      input.classLabel,
      now,
      now,
    )
    .run();
  const teacher = await getTeacherById(id);
  if (!teacher) throw new Error("교사 연결 정보를 생성하지 못했습니다.");
  return teacher;
}

export async function reconnectTeacher(
  teacher: TeacherConnection,
  input: {
    googleEmail: string;
    googleDisplayName: string;
    refreshToken: string;
    rootFolderId?: string;
    photosFolderId?: string;
    spreadsheetId?: string;
    sheetId?: number;
    sheetTitle?: string;
  },
) {
  const now = new Date().toISOString();
  const refreshTokenCiphertext = await encryptString(
    input.refreshToken,
    `google-refresh-token:${teacher.id}`,
  );
  await getEnv().DB.prepare(
    `UPDATE teacher_connections SET
       google_email = ?, google_display_name = ?, refresh_token_ciphertext = ?,
       access_token_ciphertext = NULL, access_token_expires_at = NULL,
       root_folder_id = ?, photos_folder_id = ?, spreadsheet_id = ?, sheet_id = ?, sheet_title = ?,
       updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      input.googleEmail,
      input.googleDisplayName,
      refreshTokenCiphertext,
      input.rootFolderId || teacher.rootFolderId,
      input.photosFolderId || teacher.photosFolderId,
      input.spreadsheetId || teacher.spreadsheetId,
      input.sheetId ?? teacher.sheetId,
      input.sheetTitle || teacher.sheetTitle,
      now,
      teacher.id,
    )
    .run();
  const updated = await getTeacherById(teacher.id);
  if (!updated) throw new Error("교사 연결 정보를 갱신하지 못했습니다.");
  return updated;
}

export async function updateTeacherAccessToken(
  teacherId: string,
  accessToken: string,
  expiresAt: string,
) {
  const encrypted = await encryptString(accessToken, `google-access-token:${teacherId}`);
  await getEnv().DB.prepare(
    `UPDATE teacher_connections
        SET access_token_ciphertext = ?, access_token_expires_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(encrypted, expiresAt, new Date().toISOString(), teacherId)
    .run();
}

export async function updateClassLabel(teacherId: string, classLabel: string) {
  const normalized = classLabel.normalize("NFC").trim();
  if (normalized.length < 1 || Array.from(normalized).length > 40 || /\p{Cc}/u.test(normalized)) {
    throw new HttpError(400, "학급명은 1자부터 40자까지 입력해 주세요.");
  }
  await getEnv().DB.prepare(
    "UPDATE teacher_connections SET class_label = ?, updated_at = ? WHERE id = ?",
  )
    .bind(normalized, new Date().toISOString(), teacherId)
    .run();
  return normalized;
}

export async function rotateInviteToken(
  teacherId: string,
  inviteToken: string,
  inviteTokenHash: string,
) {
  const encrypted = await encryptString(inviteToken, `class-invite-token:${teacherId}`);
  await getEnv().DB.prepare(
    `UPDATE teacher_connections
        SET invite_token_hash = ?, invite_token_ciphertext = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(inviteTokenHash, encrypted, new Date().toISOString(), teacherId)
    .run();
}

export async function revealInviteToken(teacher: TeacherConnection) {
  return decryptString(teacher.inviteTokenCiphertext, `class-invite-token:${teacher.id}`);
}

export async function revealRefreshToken(teacher: TeacherConnection) {
  return decryptString(teacher.refreshTokenCiphertext, `google-refresh-token:${teacher.id}`);
}

export async function revealAccessToken(teacher: TeacherConnection) {
  if (!teacher.accessTokenCiphertext) return null;
  return decryptString(teacher.accessTokenCiphertext, `google-access-token:${teacher.id}`);
}

export async function deleteTeacherConnection(teacherId: string) {
  const db = getEnv().DB;
  await db.batch([
    db.prepare("DELETE FROM image_tickets WHERE teacher_id = ?").bind(teacherId),
    db.prepare("DELETE FROM submission_events WHERE teacher_id = ?").bind(teacherId),
    db.prepare("DELETE FROM submission_receipts WHERE teacher_id = ?").bind(teacherId),
    db.prepare("DELETE FROM teacher_connections WHERE id = ?").bind(teacherId),
  ]);
}

export interface SubmissionReceipt {
  requestId: string;
  teacherId: string;
  observationId: string | null;
  status: "processing" | "completed";
  newlyReserved: boolean;
}

export async function reserveSubmission(
  requestId: string,
  teacherId: string,
): Promise<SubmissionReceipt> {
  const db = getEnv().DB;
  const now = new Date();
  await db.prepare("DELETE FROM submission_receipts WHERE expires_at < ?")
    .bind(now.toISOString())
    .run();

  const readExisting = async () => {
    const row = await db.prepare(
      "SELECT request_id, teacher_id, observation_id, status FROM submission_receipts WHERE request_id = ? LIMIT 1",
    )
      .bind(requestId)
      .first<{
        request_id: string;
        teacher_id: string;
        observation_id: string | null;
        status: "processing" | "completed";
      }>();
    if (!row) return null;
    if (row.teacher_id !== teacherId) throw new HttpError(409, "이미 사용된 제출 요청입니다.");
    return {
      requestId: row.request_id,
      teacherId: row.teacher_id,
      observationId: row.observation_id,
      status: row.status,
      newlyReserved: false,
    } satisfies SubmissionReceipt;
  };

  const existing = await readExisting();
  if (existing) return existing;
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  try {
    await db.prepare(
      `INSERT INTO submission_receipts
        (request_id, teacher_id, observation_id, status, created_at, expires_at)
       VALUES (?, ?, NULL, 'processing', ?, ?)`,
    )
      .bind(requestId, teacherId, now.toISOString(), expiresAt)
      .run();
  } catch (error) {
    const raced = await readExisting();
    if (raced) return raced;
    throw error;
  }
  return {
    requestId,
    teacherId,
    observationId: null,
    status: "processing",
    newlyReserved: true,
  };
}

export async function completeSubmission(requestId: string, observationId: string) {
  await getEnv().DB.prepare(
    "UPDATE submission_receipts SET observation_id = ?, status = 'completed' WHERE request_id = ?",
  )
    .bind(observationId, requestId)
    .run();
}

export async function releaseSubmission(requestId: string) {
  await getEnv().DB.prepare(
    "DELETE FROM submission_receipts WHERE request_id = ? AND status = 'processing'",
  )
    .bind(requestId)
    .run();
}

export async function enforceSubmissionRateLimit(teacherId: string, sessionId: string) {
  const db = getEnv().DB;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM submission_events WHERE expires_at < ?")
    .bind(now.toISOString())
    .run();
  const [device, teacher] = await Promise.all([
    db.prepare(
      "SELECT COUNT(*) AS count FROM submission_events WHERE teacher_id = ? AND session_id = ? AND created_at >= ?",
    )
      .bind(teacherId, sessionId, tenMinutesAgo)
      .first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM submission_events WHERE teacher_id = ? AND created_at >= ?",
    )
      .bind(teacherId, oneHourAgo)
      .first<{ count: number }>(),
  ]);
  if (Number(device?.count || 0) >= 3) {
    throw new HttpError(429, "10분 동안 제출할 수 있는 횟수를 넘었습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (Number(teacher?.count || 0) >= 100) {
    throw new HttpError(429, "현재 제출이 많습니다. 잠시 후 다시 시도해 주세요.");
  }
  await db.prepare(
    "INSERT INTO submission_events (id, teacher_id, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      teacherId,
      sessionId,
      now.toISOString(),
      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    )
    .run();
}

export async function seedImageTickets(
  teacherId: string,
  items: Array<{ observationId: string; fileId: string; imageType: string; status: string }>,
) {
  if (items.length === 0) return;
  const db = getEnv().DB;
  const now = new Date();
  await db.prepare("DELETE FROM image_tickets WHERE expires_at < ?").bind(now.toISOString()).run();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  await db.batch(
    items.map((item) =>
      db.prepare(
        `INSERT INTO image_tickets
          (observation_id, teacher_id, file_id, image_type, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(observation_id) DO UPDATE SET
           teacher_id = excluded.teacher_id,
           file_id = excluded.file_id,
           image_type = excluded.image_type,
           status = excluded.status,
           expires_at = excluded.expires_at`,
      ).bind(
        item.observationId,
        teacherId,
        item.fileId,
        item.imageType,
        item.status,
        expiresAt,
      ),
    ),
  );
}

export async function getImageTicket(observationId: string, teacherId: string) {
  const row = await getEnv().DB.prepare(
    `SELECT file_id, image_type, status
       FROM image_tickets
      WHERE observation_id = ? AND teacher_id = ? AND expires_at >= ?
      LIMIT 1`,
  )
    .bind(observationId, teacherId, new Date().toISOString())
    .first<{ file_id: string; image_type: string; status: string }>();
  return row
    ? { fileId: row.file_id, imageType: row.image_type, status: row.status }
    : null;
}

export async function deleteImageTicket(observationId: string, teacherId: string) {
  await getEnv().DB.prepare(
    "DELETE FROM image_tickets WHERE observation_id = ? AND teacher_id = ?",
  )
    .bind(observationId, teacherId)
    .run();
}
