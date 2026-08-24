import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// 이전 R2/D1 배포 자료를 삭제할 때만 읽는 호환 테이블입니다.
// 새 제출은 이 테이블에 기록하지 않습니다.
export const legacyObservations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    classId: text("class_id").notNull(),
    sessionId: text("session_id").notNull(),
    studentNumber: integer("student_number").notNull(),
    studentName: text("student_name").notNull(),
    observedAt: text("observed_at").notNull(),
    memo: text("memo").notNull().default(""),
    imageKey: text("image_key").notNull(),
    imageType: text("image_type").notNull().default("image/jpeg"),
    imageBytes: integer("image_bytes").notNull(),
    status: text("status").notNull().default("visible"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("observations_request_id_unique").on(table.requestId),
    uniqueIndex("observations_image_key_unique").on(table.imageKey),
    index("observations_class_created_idx").on(table.classId, table.createdAt),
  ],
);

export const observations = legacyObservations;

export const oauthConfig = sqliteTable("oauth_config", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientSecretCiphertext: text("client_secret_ciphertext").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teacherConnections = sqliteTable(
  "teacher_connections",
  {
    id: text("id").primaryKey(),
    googlePermissionId: text("google_permission_id").notNull(),
    googleEmail: text("google_email").notNull(),
    googleDisplayName: text("google_display_name").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenExpiresAt: text("access_token_expires_at"),
    rootFolderId: text("root_folder_id").notNull(),
    photosFolderId: text("photos_folder_id").notNull(),
    spreadsheetId: text("spreadsheet_id").notNull(),
    sheetId: integer("sheet_id").notNull(),
    sheetTitle: text("sheet_title").notNull(),
    inviteTokenHash: text("invite_token_hash").notNull(),
    inviteTokenCiphertext: text("invite_token_ciphertext").notNull(),
    classLabel: text("class_label").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("teacher_connections_google_permission_unique").on(table.googlePermissionId),
    uniqueIndex("teacher_connections_invite_hash_unique").on(table.inviteTokenHash),
  ],
);

export const submissionReceipts = sqliteTable(
  "submission_receipts",
  {
    requestId: text("request_id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teacherConnections.id, { onDelete: "cascade" }),
    observationId: text("observation_id"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("submission_receipts_expires_idx").on(table.expiresAt)],
);

export const submissionEvents = sqliteTable(
  "submission_events",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teacherConnections.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("submission_events_teacher_created_idx").on(table.teacherId, table.createdAt),
    index("submission_events_session_created_idx").on(table.sessionId, table.createdAt),
    index("submission_events_expires_idx").on(table.expiresAt),
  ],
);

export const imageTickets = sqliteTable(
  "image_tickets",
  {
    observationId: text("observation_id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teacherConnections.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    imageType: text("image_type").notNull(),
    status: text("status").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("image_tickets_teacher_idx").on(table.teacherId),
    index("image_tickets_expires_idx").on(table.expiresAt),
  ],
);
