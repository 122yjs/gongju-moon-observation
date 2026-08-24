import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const observations = sqliteTable(
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
    index("observations_session_created_idx").on(table.sessionId, table.createdAt),
    index("observations_status_created_idx").on(table.status, table.createdAt),
  ],
);
