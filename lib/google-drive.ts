import { HttpError } from "./http";
import {
  TeacherConnection,
  revealAccessToken,
  revealRefreshToken,
  updateTeacherSheetSchema,
  updateTeacherSheetTitle,
  updateTeacherAccessToken,
} from "./tenant";
import { requireOAuthConfig } from "./tenant";
import { getEnv } from "./runtime";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const MAX_SHEET_ROWS = 2000;
const SUMMARY_SHEET_TITLE = "제출 목록";
const SUMMARY_PROTECTION_DESCRIPTION = "앱이 자동으로 관리하는 읽기 전용 제출 목록";
export const SHEET_SCHEMA_VERSION = 2;
const STALE_APPEND_CONFIRM_AFTER_MS = 5 * 60 * 1000;

interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleErrorPayload {
  error?: string | { code?: number; message?: string; status?: string };
  error_description?: string;
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
}

interface PermissionList {
  permissions?: Array<{
    id?: string;
    type?: string;
    role?: string;
    emailAddress?: string;
    displayName?: string;
  }>;
}

interface SpreadsheetMetadata {
  properties?: { timeZone?: string };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      index?: number;
      hidden?: boolean;
      gridProperties?: {
        rowCount?: number;
        columnCount?: number;
        frozenRowCount?: number;
      };
    };
    protectedRanges?: Array<{
      protectedRangeId?: number;
      description?: string;
      warningOnly?: boolean;
      range?: { sheetId?: number };
    }>;
  }>;
}

interface BatchUpdateSpreadsheetResponse {
  replies?: Array<{
    addSheet?: { properties?: { sheetId?: number; title?: string } };
  }>;
}

interface AppendResponse {
  updates?: {
    updatedRange?: string;
  };
}

interface ValueRange {
  values?: unknown[][];
}

export interface DriveIdentity {
  permissionId: string;
  email: string;
  displayName: string;
}

export interface TeacherDriveResources {
  rootFolderId: string;
  photosFolderId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  summarySheetId: number;
  sheetSchemaVersion: number;
}

export interface DriveObservation {
  id: string;
  requestId: string;
  classLabel: string;
  studentNumber: number;
  studentName: string;
  /** Current effective observation time. Uses the teacher correction when present. */
  observedAt: string;
  /** Time originally entered by the student. This is never overwritten by a teacher correction. */
  originalObservedAt?: string;
  /** Photo capture time reported by the student's device when it was available. */
  photoCapturedAt?: string;
  correctedObservedAt?: string;
  correctedAt?: string;
  correctionHistory?: string;
  memo: string;
  /** Plain-text teacher feedback shown with the observation. Empty string means no feedback. */
  teacherFeedback: string;
  imageFileId: string;
  imageType: string;
  imageBytes: number;
  status: "visible" | "hidden";
  createdAt: string;
  updatedAt: string;
  imageWebViewUrl: string;
  rowNumber: number;
}

export interface ObservationPage {
  items: DriveObservation[];
  total: number;
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
}

async function upsertObservationIndex(
  teacher: Pick<TeacherConnection, "id" | "spreadsheetId">,
  observationId: string,
  rowNumber: number,
) {
  await getEnv().DB.prepare(
    `INSERT INTO observation_row_index (teacher_id, spreadsheet_id, observation_id, row_number, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(teacher_id, observation_id) DO UPDATE SET
       spreadsheet_id = excluded.spreadsheet_id,
       row_number = excluded.row_number,
       updated_at = excluded.updated_at`,
  )
    .bind(teacher.id, teacher.spreadsheetId, observationId, rowNumber, new Date().toISOString())
    .run();
}

async function deleteObservationIndex(teacherId: string, observationId: string) {
  await getEnv().DB.prepare(
    "DELETE FROM observation_row_index WHERE teacher_id = ? AND observation_id = ?",
  )
    .bind(teacherId, observationId)
    .run();
}

async function clearObservationIndexes(teacherId: string) {
  await getEnv().DB.prepare("DELETE FROM observation_row_index WHERE teacher_id = ?")
    .bind(teacherId)
    .run();
}

async function getObservationIndex(teacherId: string, observationId: string) {
  const row = await getEnv().DB.prepare(
    `SELECT row_number
       FROM observation_row_index
      WHERE teacher_id = ? AND observation_id = ?
      LIMIT 1`,
  )
    .bind(teacherId, observationId)
    .first<{ row_number: number }>();
  return Number(row?.row_number || 0) || null;
}

type SheetWriteOperation =
  | "append"
  | "update-status"
  | "update-observed-at"
  | "update-feedback"
  | "delete-observation"
  | "schema"
  | "delete-class"
  | "disconnect";

interface SheetWriteIntent {
  operation: SheetWriteOperation;
  observationId?: string | null;
  expectedVersion?: string | null;
  intendedVersion?: string | null;
}

interface SheetWriteLockRow {
  spreadsheet_id: string;
  teacher_id: string | null;
  owner_token: string;
  operation: SheetWriteOperation;
  observation_id: string | null;
  expected_version: string | null;
  intended_version: string | null;
  state: "active" | "uncertain";
  created_at: string;
}

export interface SheetWriteGuard {
  setVersions(expectedVersion: string | null, intendedVersion: string | null): Promise<void>;
  writeGoogle<T>(action: () => Promise<T>): Promise<T>;
}

export class SheetWriteUncertainError extends HttpError {
  readonly sheetWriteUncertain = true;

  constructor() {
    super(503, "Google Sheets 변경 결과를 확인할 수 없습니다. 시트 연결 점검으로 상태를 확인해 주세요.");
  }
}

export function isSheetWriteUncertainError(error: unknown): error is SheetWriteUncertainError {
  return error instanceof SheetWriteUncertainError
    || (typeof error === "object" && error !== null && "sheetWriteUncertain" in error);
}

async function readSheetWriteLock(spreadsheetId: string) {
  return getEnv().DB.prepare(
    `SELECT spreadsheet_id, teacher_id, owner_token, operation, observation_id,
            expected_version, intended_version, state, created_at
       FROM sheet_write_locks
      WHERE spreadsheet_id = ?
      LIMIT 1`,
  )
    .bind(spreadsheetId)
    .first<SheetWriteLockRow>();
}

async function releaseSheetWriteLock(spreadsheetId: string, ownerToken: string) {
  await getEnv().DB.prepare(
    "DELETE FROM sheet_write_locks WHERE spreadsheet_id = ? AND owner_token = ?",
  )
    .bind(spreadsheetId, ownerToken)
    .run();
}

export async function withSheetWriteLock<T>(
  teacher: Pick<TeacherConnection, "id" | "spreadsheetId">,
  intent: SheetWriteIntent,
  action: (guard: SheetWriteGuard) => Promise<T>,
) {
  const ownerToken = crypto.randomUUID();
  let acquired: SheetWriteLockRow | null;
  try {
    await getEnv().DB.prepare(
      `INSERT INTO sheet_write_locks (
         spreadsheet_id, teacher_id, owner_token, operation, observation_id,
         expected_version, intended_version, state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT(spreadsheet_id) DO NOTHING`,
    )
      .bind(
        teacher.spreadsheetId,
        teacher.id || null,
        ownerToken,
        intent.operation,
        intent.observationId || null,
        intent.expectedVersion || null,
        intent.intendedVersion || null,
        new Date().toISOString(),
      )
      .run();
    acquired = await readSheetWriteLock(teacher.spreadsheetId);
  } catch (error) {
    // No Google write has started. Remove only this attempt's token, even if
    // INSERT succeeded but its response or the verification read was lost.
    await releaseSheetWriteLock(teacher.spreadsheetId, ownerToken).catch(() => undefined);
    throw error;
  }
  if (acquired?.owner_token !== ownerToken) {
    throw new HttpError(409, "Google Sheets 변경을 확인 중입니다. 시트 연결 점검 후 다시 시도해 주세요.");
  }

  let googleWriteAttempted = false;
  let googleWriteAttempts = 0;
  let uncertain = false;
  const markUncertain = async () => {
    // 먼저 메모리에 표시합니다. D1 응답 자체가 끊겨도 finally에서 잠금을 풀면 안 됩니다.
    uncertain = true;
    await getEnv().DB.prepare(
      `UPDATE sheet_write_locks SET state = 'uncertain'
        WHERE spreadsheet_id = ? AND owner_token = ?`,
    ).bind(teacher.spreadsheetId, ownerToken).run();
  };
  const guard: SheetWriteGuard = {
    async setVersions(expectedVersion, intendedVersion) {
      await getEnv().DB.prepare(
        `UPDATE sheet_write_locks
            SET expected_version = ?, intended_version = ?
          WHERE spreadsheet_id = ? AND owner_token = ?`,
      )
        .bind(expectedVersion, intendedVersion, teacher.spreadsheetId, ownerToken)
        .run();
    },
    async writeGoogle<TValue>(write: () => Promise<TValue>) {
      googleWriteAttempted = true;
      googleWriteAttempts += 1;
      try {
        return await write();
      } catch (error) {
        // A single atomic append explicitly rejected by Google did not change
        // the Sheet. Do not turn quota/auth/validation rejection into a permanent
        // class lock. Never apply this to timeouts, 5xx, or multi-step operations.
        if (intent.operation === "append" && googleWriteAttempts === 1
          && error instanceof GoogleRequestError
          && [400, 401, 403, 404, 413, 429].includes(error.googleStatus)) {
          googleWriteAttempted = false;
          throw error;
        }
        await markUncertain().catch(() => undefined);
        throw new SheetWriteUncertainError();
      }
    },
  };

  try {
    const result = await action(guard);
    await releaseSheetWriteLock(teacher.spreadsheetId, ownerToken);
    return result;
  } catch (error) {
    // Google 쓰기를 한 번이라도 시작했다면 후속 D1 작업 실패도 보수적으로 불명확 상태로 남깁니다.
    if (googleWriteAttempted) {
      if (!uncertain) await markUncertain().catch(() => undefined);
      if (!isSheetWriteUncertainError(error)) throw new SheetWriteUncertainError();
    } else {
      await releaseSheetWriteLock(teacher.spreadsheetId, ownerToken);
    }
    throw error;
  }
}

export async function withSheetWriteLocks<T>(
  teachers: Array<Pick<TeacherConnection, "id" | "spreadsheetId">>,
  operation: "delete-class" | "disconnect",
  action: (guards: SheetWriteGuard[]) => Promise<T>,
) {
  const ordered = [...teachers].sort((left, right) => left.spreadsheetId.localeCompare(right.spreadsheetId));
  const guards: SheetWriteGuard[] = [];
  const acquire = (index: number): Promise<T> => {
    if (index >= ordered.length) return action(guards);
    return withSheetWriteLock(ordered[index], { operation }, async (guard) => {
      guards.push(guard);
      try {
        return await acquire(index + 1);
      } finally {
        guards.pop();
      }
    });
  };
  return acquire(0);
}

export async function observationVersion(observation: DriveObservation) {
  const content = JSON.stringify([
    observation.id,
    observation.memo,
    observation.teacherFeedback,
    observation.observedAt,
    observation.originalObservedAt || observation.observedAt,
    observation.correctedAt || "",
    observation.correctionHistory || "",
    observation.status,
    observation.createdAt,
    observation.updatedAt || observation.correctedAt || observation.createdAt,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function observationSummary(observation: DriveObservation, updatedAt?: string) {
  return {
    id: observation.id,
    memo: observation.memo,
    teacherFeedback: observation.teacherFeedback,
    observedAt: observation.observedAt,
    originalObservedAt: observation.originalObservedAt || observation.observedAt,
    correctedAt: observation.correctedAt || null,
    status: observation.status,
    updatedAt: updatedAt || observation.updatedAt,
    version: await observationVersion(observation),
  };
}

function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

function normalizeGoogleError(payload: GoogleErrorPayload | null, status: number) {
  const nested = payload && typeof payload.error === "object" ? payload.error.message : null;
  const flat = payload && typeof payload.error === "string" ? payload.error : null;
  const message = nested || payload?.error_description || flat;
  if (status === 401) return "Google Drive 연결이 만료되었습니다. 교사 화면에서 다시 연결해 주세요.";
  if (status === 403) return message || "Google Drive에서 이 작업을 허용하지 않았습니다.";
  if (status === 404) return "Google Drive의 수업 폴더 또는 파일을 찾을 수 없습니다.";
  if (status === 429) return "Google Drive 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.";
  return message || "Google Drive 요청을 처리하지 못했습니다.";
}

async function readGooglePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as GoogleErrorPayload;
  } catch {
    return null;
  }
}

class GoogleRequestError extends HttpError {
  constructor(readonly googleStatus: number, message: string) {
    super(googleStatus >= 500 ? 502 : googleStatus, message);
  }
}

async function googleFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  allowedStatuses: number[] = [],
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const payload = await readGooglePayload(response);
    throw new GoogleRequestError(response.status, normalizeGoogleError(payload, response.status));
  }
  return response;
}

async function googleJson<T>(url: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await googleFetch(url, accessToken, { ...init, headers });
  return (await response.json()) as T;
}

async function tokenRequest(values: Record<string, string>) {
  const config = await requireOAuthConfig();
  const body = new URLSearchParams({
    ...values,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const payload = (await readGooglePayload(response)) as GoogleErrorPayload | null;
    throw new HttpError(401, normalizeGoogleError(payload, response.status));
  }
  const tokens = (await response.json()) as OAuthTokenResponse;
  if (!tokens.access_token) throw new HttpError(502, "Google에서 접근 토큰을 받지 못했습니다.");
  return tokens;
}

export async function buildGoogleAuthorizationUrl(origin: string, state: string) {
  const config = await requireOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_FILE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeAuthorizationCode(origin: string, code: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
  });
  if (tokens.scope) {
    const scopes = new Set(tokens.scope.split(/\s+/).filter(Boolean));
    if (!scopes.has(DRIVE_FILE_SCOPE)) {
      throw new HttpError(403, "Google Drive의 앱 전용 파일 권한이 승인되지 않았습니다.");
    }
  }
  return tokens;
}

export async function getTeacherAccessToken(teacher: TeacherConnection) {
  const cachedExpiry = teacher.accessTokenExpiresAt
    ? new Date(teacher.accessTokenExpiresAt).getTime()
    : 0;
  if (teacher.accessTokenCiphertext && cachedExpiry > Date.now() + 60_000) {
    const cached = await revealAccessToken(teacher);
    if (cached) return cached;
  }

  const refreshToken = await revealRefreshToken(teacher);
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString();
  await updateTeacherAccessToken(teacher.accountId, tokens.access_token, expiresAt);
  return tokens.access_token;
}

async function createDriveFile(
  accessToken: string,
  metadata: { name: string; mimeType: string; parents?: string[] },
) {
  const query = new URLSearchParams({ fields: "id,name,mimeType,parents,webViewLink" });
  return googleJson<DriveFile>(`${DRIVE_API}/files?${query}`, accessToken, {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

export async function createIdentityFolder(accessToken: string) {
  const file = await createDriveFile(accessToken, {
    name: "달 관찰 탐험대",
    mimeType: FOLDER_MIME,
  });
  if (!file.id) throw new HttpError(502, "Google Drive에 수업 폴더를 만들지 못했습니다.");
  return file.id;
}

export async function createClassRootFolder(accessToken: string, classLabel: string) {
  const safeLabel = classLabel.normalize("NFC").trim() || "새 반";
  const file = await createDriveFile(accessToken, {
    name: `달 관찰 탐험대 - ${safeLabel}`,
    mimeType: FOLDER_MIME,
  });
  if (!file.id) throw new HttpError(502, "Google Drive에 반 폴더를 만들지 못했습니다.");
  return file.id;
}

export async function getFolderOwner(accessToken: string, folderId: string): Promise<DriveIdentity> {
  const fields = "permissions(id,type,role,emailAddress,displayName)";
  const response = await googleJson<PermissionList>(
    `${DRIVE_API}/files/${encodeURIComponent(folderId)}/permissions?${new URLSearchParams({ fields })}`,
    accessToken,
  );
  const owner = response.permissions?.find(
    (permission) => permission.type === "user" && permission.role === "owner" && permission.id,
  );
  if (!owner?.id) {
    throw new HttpError(403, "Google Drive 폴더 소유 계정을 확인하지 못했습니다.");
  }
  return {
    permissionId: owner.id,
    email: owner.emailAddress || "",
    displayName: owner.displayName || owner.emailAddress || "Google 사용자",
  };
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function updateSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW",
  guard?: SheetWriteGuard,
) {
  const query = new URLSearchParams({ valueInputOption });
  const write = () => googleJson(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
    { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) },
  );
  await (guard ? guard.writeGoogle(write) : write());
}

async function updateSheetRanges(
  accessToken: string,
  spreadsheetId: string,
  data: Array<{ range: string; values: unknown[][] }>,
  guard?: SheetWriteGuard,
) {
  const write = () => googleJson(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: data.map((item) => ({ ...item, majorDimension: "ROWS" })),
      }),
    },
  );
  await (guard ? guard.writeGoogle(write) : write());
}

async function batchUpdateSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
  guard?: SheetWriteGuard,
) {
  const write = () => googleJson<BatchUpdateSpreadsheetResponse>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    accessToken,
    { method: "POST", body: JSON.stringify({ requests }) },
  );
  return guard ? guard.writeGoogle(write) : write();
}

async function renameAndFormatSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  title: string,
  guard?: SheetWriteGuard,
) {
  const write = () => googleJson(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, title, gridProperties: { frozenRowCount: 1 } },
              fields: "title,gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
        ],
      }),
    },
  );
  await (guard ? guard.writeGoogle(write) : write());
}

function summaryFormula(rawSheetTitle: string) {
  const raw = quoteSheetTitle(rawSheetTitle);
  const endRow = MAX_SHEET_ROWS + 1;
  const submittedAtKst = `IF(${raw}!L2:L${endRow}="","",TEXT(DATEVALUE(LEFT(${raw}!L2:L${endRow},10))+TIMEVALUE(MID(${raw}!L2:L${endRow},12,8))+TIME(9,0,0),"yyyy-mm-dd hh:mm"))`;
  return `=ARRAYFORMULA(IFERROR(SORT(FILTER({${raw}!E2:E${endRow},${raw}!D2:D${endRow},SUBSTITUTE(${raw}!F2:F${endRow},"T"," "),IF(${raw}!Q2:Q${endRow}="","",SUBSTITUTE(${raw}!Q2:Q${endRow},"T"," ")),IF(${raw}!N2:N${endRow}="","",SUBSTITUTE(${raw}!N2:N${endRow},"T"," ")),${submittedAtKst},${raw}!G2:G${endRow},IF(${raw}!J2:J${endRow}="","",ROUND(${raw}!J2:J${endRow}/1048576,2)&" MB"),IF(${raw}!M2:M${endRow}="","",HYPERLINK(${raw}!M2:M${endRow},"사진 열기"))},${raw}!A2:A${endRow}<>"",${raw}!K2:K${endRow}="visible"),6,FALSE),""))`;
}

const OBSERVATION_HEADERS = [
  "관찰 ID",
  "요청 ID",
  "학급",
  "번호",
  "이름",
  "학생 설정 관찰 시각",
  "관찰 기록",
  "사진 파일 ID",
  "사진 형식",
  "사진 용량",
  "공개 상태",
  "실제 제출 시각 (UTC)",
  "사진 링크",
  "교사 정정 관찰 시각",
  "최근 정정 시각 (UTC)",
  "관찰 시각 정정 이력",
  "사진 촬영 시각 (기기 기록)",
  "교사 피드백",
  "최근 수정 시각 (UTC)",
];

async function ensureObservationHeaders(
  accessToken: string,
  teacher: Pick<TeacherDriveResources, "spreadsheetId" | "sheetTitle">,
  guard?: SheetWriteGuard,
) {
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A1:S1`;
  const current = await googleJson<ValueRange>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}?${new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" })}`,
    accessToken,
  );
  const row = current.values?.[0] || [];
  const alreadyCurrent = OBSERVATION_HEADERS.every((header, index) => cell(row, index) === header);
  if (alreadyCurrent) return false;
  await updateSheetValues(
    accessToken,
    teacher.spreadsheetId,
    range,
    [OBSERVATION_HEADERS],
    "RAW",
    guard,
  );
  return true;
}

async function ensureTeacherSummarySheetUnlocked(
  accessToken: string,
  teacher: Pick<TeacherDriveResources, "spreadsheetId" | "sheetId" | "sheetTitle"> & { id?: string },
  guard: SheetWriteGuard,
) {
  const fields = [
    "properties(timeZone)",
    "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount)),protectedRanges(protectedRangeId,description,warningOnly,range(sheetId)))",
  ].join(",");
  const metadata = await googleJson<SpreadsheetMetadata>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}?${new URLSearchParams({ fields })}`,
    accessToken,
  );
  const rawSheet = metadata.sheets?.find(
    (sheet) => sheet.properties?.sheetId === teacher.sheetId,
  );
  if (!rawSheet?.properties?.title) {
    throw new HttpError(502, "Google Sheets 원본 기록 탭을 찾지 못했습니다.");
  }
  const actualSheetTitle = rawSheet.properties.title;
  if (teacher.id && actualSheetTitle !== teacher.sheetTitle) {
    await updateTeacherSheetTitle(teacher.id, actualSheetTitle);
  }
  const currentTeacher = { ...teacher, sheetTitle: actualSheetTitle };
  const rawHeadersChanged = await ensureObservationHeaders(accessToken, currentTeacher, guard);

  let summarySheet = metadata.sheets?.find(
    (sheet) => sheet.properties?.title === SUMMARY_SHEET_TITLE,
  );
  const setupRequests: unknown[] = [];
  if (metadata.properties?.timeZone !== "Asia/Seoul") {
    setupRequests.push({
      updateSpreadsheetProperties: {
        properties: { timeZone: "Asia/Seoul" },
        fields: "timeZone",
      },
    });
  }
  if (summarySheet?.properties?.sheetId == null) {
    setupRequests.push({
      addSheet: {
        properties: {
          title: SUMMARY_SHEET_TITLE,
          index: 0,
          gridProperties: {
            rowCount: MAX_SHEET_ROWS + 1,
            columnCount: 9,
            frozenRowCount: 1,
          },
        },
      },
    });
  } else {
    const grid = summarySheet.properties.gridProperties;
    if (
      summarySheet.properties.index !== 0 ||
      summarySheet.properties.hidden === true ||
      grid?.frozenRowCount !== 1 ||
      (grid?.columnCount || 0) < 9
    ) {
      setupRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: summarySheet.properties.sheetId,
            index: 0,
            hidden: false,
            gridProperties: { frozenRowCount: 1, columnCount: Math.max(9, grid?.columnCount || 0) },
          },
          fields: "index,hidden,gridProperties.frozenRowCount,gridProperties.columnCount",
        },
      });
    }
  }
  if (!rawSheet.properties.hidden) {
    setupRequests.push({
      updateSheetProperties: {
        properties: { sheetId: teacher.sheetId, hidden: true },
        fields: "hidden",
      },
    });
  }

  if (setupRequests.length > 0) {
    const result = await batchUpdateSpreadsheet(
      accessToken,
      teacher.spreadsheetId,
      setupRequests,
      guard,
    );
    if (summarySheet?.properties?.sheetId == null) {
      const added = result.replies?.find((reply) => reply.addSheet)?.addSheet?.properties;
      const addedSheetId = Number(added?.sheetId);
      if (!Number.isInteger(addedSheetId)) {
        throw new HttpError(502, "Google Sheets 제출 목록 탭을 만들지 못했습니다.");
      }
      summarySheet = { properties: { ...added, sheetId: addedSheetId } };
    }
  }

  const summarySheetId = Number(summarySheet?.properties?.sheetId);
  if (!Number.isInteger(summarySheetId)) {
    throw new HttpError(502, "Google Sheets 제출 목록 탭을 준비하지 못했습니다.");
  }
  const summaryTitle = quoteSheetTitle(SUMMARY_SHEET_TITLE);
  const summaryHeaders = [
    "이름",
    "출석번호",
    "학생 설정 관찰 시각 (한국 시간)",
    "사진 촬영 시각 (기기 기록)",
    "교사 정정 관찰 시각 (한국 시간)",
    "실제 제출 시각 (한국 시간)",
    "설명",
    "사진 용량",
    "사진 원본 링크",
  ];
  const formula = summaryFormula(rawSheet.properties.title);
  const [currentSummaryHeaders, currentFormula] = await Promise.all([
    googleJson<ValueRange>(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(`${summaryTitle}!A1:I1`)}?${new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" })}`,
      accessToken,
    ),
    googleJson<ValueRange>(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(`${summaryTitle}!A2`)}?${new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMULA" })}`,
      accessToken,
    ),
  ]);
  const summaryHeaderRow = currentSummaryHeaders.values?.[0] || [];
  const summaryHeadersChanged = !summaryHeaders.every((header, index) => cell(summaryHeaderRow, index) === header);
  const formulaChanged = cell(currentFormula.values?.[0] || [], 0) !== formula;
  if (summaryHeadersChanged) {
    await updateSheetValues(
      accessToken,
      teacher.spreadsheetId,
      `${summaryTitle}!A1:I1`,
      [summaryHeaders],
      "RAW",
      guard,
    );
  }
  if (formulaChanged) {
    await updateSheetValues(
      accessToken,
      teacher.spreadsheetId,
      `${summaryTitle}!A2`,
      [[formula]],
      "USER_ENTERED",
      guard,
    );
  }

  const protectedRange = summarySheet?.protectedRanges?.find(
    (item) => item.description === SUMMARY_PROTECTION_DESCRIPTION,
  );
  const protectedRangeSettings = {
    range: { sheetId: summarySheetId },
    description: SUMMARY_PROTECTION_DESCRIPTION,
    warningOnly: true,
  };
  const formatRequests: unknown[] = [
    {
      repeatCell: {
        range: { sheetId: summarySheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.75, blue: 0.2 },
            horizontalAlignment: "CENTER",
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat.bold)",
      },
    },
    ...[120, 90, 185, 185, 185, 185, 320, 110, 120].map((pixelSize, index) => ({
      updateDimensionProperties: {
        range: {
          sheetId: summarySheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1,
        },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    })),
  ];
  if (Number.isInteger(protectedRange?.protectedRangeId)) {
    formatRequests.push({
      updateProtectedRange: {
        protectedRange: {
          protectedRangeId: protectedRange?.protectedRangeId,
          ...protectedRangeSettings,
        },
        fields: "range,description,warningOnly",
      },
    });
  } else {
    formatRequests.push({ addProtectedRange: { protectedRange: protectedRangeSettings } });
  }
  if (rawHeadersChanged || setupRequests.length > 0 || summaryHeadersChanged || formulaChanged || !protectedRange) {
    await batchUpdateSpreadsheet(accessToken, teacher.spreadsheetId, formatRequests, guard);
  }
  if (teacher.id) {
    await updateTeacherSheetSchema(teacher.id, actualSheetTitle, summarySheetId, SHEET_SCHEMA_VERSION);
  }
  return summarySheetId;
}

export async function ensureTeacherSummarySheet(
  accessToken: string,
  teacher: Pick<TeacherDriveResources, "spreadsheetId" | "sheetId" | "sheetTitle"> & { id?: string },
) {
  return withSheetWriteLock(
    { id: teacher.id || "", spreadsheetId: teacher.spreadsheetId },
    { operation: "schema" },
    (guard) => ensureTeacherSummarySheetUnlocked(accessToken, teacher, guard),
  );
}

export async function initializeTeacherDrive(
  accessToken: string,
  rootFolderId: string,
): Promise<TeacherDriveResources> {
  const photos = await createDriveFile(accessToken, {
    name: "관찰 사진",
    mimeType: FOLDER_MIME,
    parents: [rootFolderId],
  });
  const spreadsheet = await createDriveFile(accessToken, {
    name: "달 관찰 제출 기록",
    mimeType: SPREADSHEET_MIME,
    parents: [rootFolderId],
  });
  if (!photos.id || !spreadsheet.id) {
    throw new HttpError(502, "Google Drive에 수업 제출함을 만들지 못했습니다.");
  }

  const metadata = await googleJson<SpreadsheetMetadata>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheet.id)}?fields=sheets(properties(sheetId,title))`,
    accessToken,
  );
  const first = metadata.sheets?.[0]?.properties;
  if (!Number.isInteger(first?.sheetId)) {
    throw new HttpError(502, "Google Sheets 제출 목록을 준비하지 못했습니다.");
  }
  const sheetId = Number(first?.sheetId);
  const sheetTitle = "관찰 기록";
  const summarySheetId = await withSheetWriteLock(
    { id: "", spreadsheetId: spreadsheet.id },
    { operation: "schema" },
    async (guard) => {
      await renameAndFormatSheet(accessToken, spreadsheet.id, sheetId, sheetTitle, guard);
      return ensureTeacherSummarySheetUnlocked(accessToken, {
        spreadsheetId: spreadsheet.id,
        sheetId,
        sheetTitle,
      }, guard);
    },
  );

  return {
    rootFolderId,
    photosFolderId: photos.id,
    spreadsheetId: spreadsheet.id,
    sheetId,
    sheetTitle,
    summarySheetId,
    sheetSchemaVersion: SHEET_SCHEMA_VERSION,
  };
}

export async function verifyTeacherDrive(accessToken: string, teacher: TeacherConnection) {
  for (const id of [teacher.rootFolderId, teacher.photosFolderId, teacher.spreadsheetId]) {
    const file = await googleJson<DriveFile>(
      `${DRIVE_API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "id,trashed" })}`,
      accessToken,
    );
    if (!file.id || file.trashed) return false;
  }
  return true;
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  await googleFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    accessToken,
    { method: "DELETE" },
    [404],
  );
}

function safeFilename(number: number, name: string, observedAt: string, extension: string) {
  const safeName = Array.from(name.normalize("NFC"))
    .filter((character) => /[\p{L}\p{N}_-]/u.test(character))
    .join("")
    .slice(0, 20) || "학생";
  const time = observedAt.replace(/[^0-9]/g, "").slice(0, 12);
  return `${String(number).padStart(2, "0")}번_${safeName}_${time}.${extension}`;
}

export async function uploadObservationPhoto(
  accessToken: string,
  teacher: TeacherConnection,
  input: {
    bytes: Uint8Array;
    contentType: string;
    extension: string;
    studentNumber: number;
    studentName: string;
    observedAt: string;
  },
) {
  const boundary = `moon-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: safeFilename(input.studentNumber, input.studentName, input.observedAt, input.extension),
    parents: [teacher.photosFolderId],
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`,
    input.bytes,
    `\r\n--${boundary}--`,
  ]);
  const query = new URLSearchParams({ uploadType: "multipart", fields: "id,name,webViewLink" });
  const result = await googleJson<DriveFile>(`${DRIVE_UPLOAD_API}/files?${query}`, accessToken, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!result.id) throw new HttpError(502, "Google Drive에 사진을 저장하지 못했습니다.");
  return { id: result.id, webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view` };
}

export async function appendObservationRow(
  accessToken: string,
  teacher: TeacherConnection,
  observation: Omit<DriveObservation, "rowNumber">,
) {
  // append 범위는 값의 폭이 아니라 기존 표를 찾는 범위입니다. 선택 항목인
  // Q/S열을 별도 표로 오인하지 않도록 항상 관찰 ID가 있는 A열을 기준으로 찾습니다.
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A:A`;
  const query = new URLSearchParams({
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: "false",
    fields: "updates(updatedRange)",
  });
  const intendedVersion = await observationVersion({ ...observation, rowNumber: 0 });
  await withSheetWriteLock(
    teacher,
    { operation: "append", observationId: observation.id, intendedVersion },
    async (guard) => {
      await guard.setVersions(null, intendedVersion);
      const response = await guard.writeGoogle(() => googleJson<AppendResponse>(
        `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}:append?${query}`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            range,
            majorDimension: "ROWS",
            values: [[
              observation.id,
              observation.requestId,
              observation.classLabel,
              observation.studentNumber,
              observation.studentName,
              observation.observedAt,
              observation.memo,
              observation.imageFileId,
              observation.imageType,
              observation.imageBytes,
              observation.status,
              observation.createdAt,
              observation.imageWebViewUrl,
              "",
              "",
              "",
              observation.photoCapturedAt || "",
              observation.teacherFeedback,
              observation.updatedAt,
            ]],
          }),
        },
      ));
      const match = /!A(\d+):S(\d+)$/.exec(response.updates?.updatedRange || "");
      if (!match || match[1] !== match[2] || Number(match[1]) < 2) {
        // 예상 밖 위치에 저장됐다면 사진과 잠금을 보존하고 운영자 대조를 기다립니다.
        throw new SheetWriteUncertainError();
      }
      await upsertObservationIndex(teacher, observation.id, Number(match[1])).catch((error) => {
        // Sheets 저장은 이미 끝났습니다. 색인은 다음 단건 조회에서 복구할 수 있습니다.
        console.warn("관찰 기록 행 색인을 저장하지 못했습니다.", error);
      });
    },
  );
}

function cell(row: unknown[], index: number) {
  const value = row[index];
  return value === null || value === undefined ? "" : String(value);
}

function parseObservation(row: unknown[], rowNumber: number): DriveObservation | null {
  const id = cell(row, 0);
  const requestId = cell(row, 1);
  const studentNumber = Number(cell(row, 3));
  const imageBytes = Number(cell(row, 9));
  const statusText = cell(row, 10);
  const originalObservedAt = cell(row, 5);
  const correctedObservedAt = cell(row, 13);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(studentNumber)) return null;
  return {
    id,
    requestId,
    classLabel: cell(row, 2),
    studentNumber,
    studentName: cell(row, 4),
    observedAt: correctedObservedAt || originalObservedAt,
    originalObservedAt,
    photoCapturedAt: cell(row, 16) || undefined,
    correctedObservedAt: correctedObservedAt || undefined,
    correctedAt: cell(row, 14) || undefined,
    correctionHistory: cell(row, 15) || undefined,
    memo: cell(row, 6),
    teacherFeedback: cell(row, 17),
    imageFileId: cell(row, 7),
    imageType: cell(row, 8) || "image/jpeg",
    imageBytes: Number.isFinite(imageBytes) ? imageBytes : 0,
    status: statusText === "hidden" ? "hidden" : "visible",
    createdAt: cell(row, 11),
    updatedAt: cell(row, 18) || cell(row, 14) || cell(row, 11),
    imageWebViewUrl: cell(row, 12),
    rowNumber,
  };
}

async function readObservationRows(accessToken: string, teacher: TeacherConnection) {
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A2:S${MAX_SHEET_ROWS + 1}`;
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  const response = await googleJson<ValueRange>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
  );
  return (response.values || [])
    .map((row, index) => parseObservation(row, index + 2))
    .filter((item): item is DriveObservation => Boolean(item));
}

async function readObservationRowAt(
  accessToken: string,
  teacher: TeacherConnection,
  rowNumber: number,
) {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return null;
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A${rowNumber}:S${rowNumber}`;
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  let response: ValueRange;
  try {
    response = await googleJson<ValueRange>(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
      accessToken,
    );
  } catch (error) {
    if (error instanceof HttpError && (error.status === 400 || error.status === 404)) return null;
    throw error;
  }
  const row = response.values?.[0];
  return row ? parseObservation(row, rowNumber) : null;
}

async function findObservationRowNumber(
  accessToken: string,
  teacher: TeacherConnection,
  observationId: string,
) {
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A2:A`;
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  const response = await googleJson<ValueRange>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
  );
  const index = (response.values || []).findIndex((row) => cell(row, 0) === observationId);
  return index < 0 ? null : index + 2;
}

function compareObservation(left: DriveObservation, right: DriveObservation) {
  const byTime = right.createdAt.localeCompare(left.createdAt);
  return byTime || right.id.localeCompare(left.id);
}

export async function listObservationRows(
  accessToken: string,
  teacher: TeacherConnection,
  options: {
    limit: number;
    cursor: { createdAt: string; id: string } | null;
    includeHidden: boolean;
    observedDate?: string | null;
    studentNumber?: number | null;
  },
): Promise<ObservationPage> {
  const all = (await readObservationRows(accessToken, teacher))
    .filter((row) => options.includeHidden || row.status === "visible")
    .filter((row) => !options.observedDate || row.observedAt.startsWith(`${options.observedDate}T`))
    .filter((row) => options.studentNumber == null || row.studentNumber === options.studentNumber)
    .sort(compareObservation);
  const afterCursor = options.cursor
    ? all.filter(
        (row) =>
          row.createdAt < options.cursor!.createdAt ||
          (row.createdAt === options.cursor!.createdAt && row.id < options.cursor!.id),
      )
    : all;
  const items = afterCursor.slice(0, options.limit);
  const hasMore = afterCursor.length > options.limit;
  const last = items.at(-1);
  return {
    items,
    total: all.length,
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function findObservationRow(
  accessToken: string,
  teacher: TeacherConnection,
  observationId: string,
) {
  const cachedRowNumber = await getObservationIndex(teacher.id, observationId).catch(() => null);
  if (cachedRowNumber) {
    const cached = await readObservationRowAt(accessToken, teacher, cachedRowNumber);
    if (cached?.id === observationId) return cached;
  }

  // 단건 복구는 ID 열만 끝까지 읽습니다. 목록의 2,000행 상한 때문에 오래된 행을 놓치면 안 됩니다.
  let found: DriveObservation | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const recoveredRowNumber = await findObservationRowNumber(accessToken, teacher, observationId);
    if (!recoveredRowNumber) break;
    const candidate = await readObservationRowAt(accessToken, teacher, recoveredRowNumber);
    if (candidate?.id === observationId) {
      found = candidate;
      break;
    }
    if (attempt === 1) {
      throw new HttpError(409, "관찰 기록 행이 이동했습니다. 다시 시도해 주세요.");
    }
  }
  if (found) {
    await upsertObservationIndex(teacher, observationId, found.rowNumber).catch(() => {
      console.warn("관찰 기록 행 색인을 갱신하지 못했습니다. 확인된 시트 기록을 사용합니다.");
    });
  } else {
    await deleteObservationIndex(teacher.id, observationId).catch(() => undefined);
  }
  return found;
}

export async function recoverSheetWriteLock(accessToken: string, teacher: TeacherConnection) {
  const lock = await readSheetWriteLock(teacher.spreadsheetId);
  if (!lock) return { recovered: false as const };

  if (lock.state === "active") {
    const age = Date.now() - new Date(lock.created_at).getTime();
    const canVerifyAppend = lock.operation === "append" && lock.teacher_id === teacher.id
      && lock.observation_id && lock.intended_version && age >= STALE_APPEND_CONFIRM_AFTER_MS;
    // Age permits verification, NEVER automatic expiry. A single append has no
    // later Google mutation once its exact persisted version is visible below.
    if (!canVerifyAppend) {
      throw new HttpError(409, "시트 변경 요청이 진행 중이거나 비정상 종료되었습니다. 운영자 확인이 필요합니다.");
    }
  }

  if (lock.observation_id) {
    const current = await findObservationRow(accessToken, teacher, lock.observation_id);
    const actualVersion = current ? await observationVersion(current) : null;
    const applied = lock.operation === "delete-observation"
      ? current === null
      : actualVersion !== null && actualVersion === lock.intended_version;
    if (!applied) {
      throw new HttpError(409, "시트에서 변경 완료를 확인하지 못했습니다. 지연 적용 가능성이 있어 운영자 확인이 필요합니다.");
    }
    if (lock.operation === "delete-observation" && applied) {
      await clearObservationIndexes(teacher.id);
    }
    if (lock.operation === "append" && current) {
      // Repair only an existing receipt for this class and this request before
      // unlocking. A retry then returns the saved ID instead of uploading twice.
      await getEnv().DB.prepare(
        `UPDATE submission_receipts SET observation_id = ?, status = 'completed'
          WHERE request_id = ? AND teacher_id = ? AND status = 'processing'`,
      ).bind(current.id, current.requestId, teacher.id).run();
    }
    await releaseSheetWriteLock(teacher.spreadsheetId, lock.owner_token);
    return { recovered: true as const, operation: lock.operation, outcome: "applied" as const };
  }

  // 구조 변경과 학급 정리는 여러 Google 요청으로 이루어져 부분 적용 여부를 한 값으로 증명할 수 없습니다.
  throw new HttpError(409, "여러 단계의 Google Drive 변경이 중단되었습니다. 운영자 확인이 필요합니다.");
}

export async function updateObservationStatus(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
  status: "visible" | "hidden",
  guard?: SheetWriteGuard,
  updateTimestamp = new Date().toISOString(),
) {
  const updatedAt = updateTimestamp;
  await updateSheetRanges(
    accessToken,
    teacher.spreadsheetId,
    [
      { range: `${quoteSheetTitle(teacher.sheetTitle)}!K${observation.rowNumber}`, values: [[status]] },
      { range: `${quoteSheetTitle(teacher.sheetTitle)}!S${observation.rowNumber}`, values: [[updatedAt]] },
    ],
    guard,
  );
  await upsertObservationIndex(teacher, observation.id, observation.rowNumber).catch(() => undefined);
  return { status, updatedAt };
}

export async function updateObservationObservedAt(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
  observedAt: string,
  reason: string,
  guard?: SheetWriteGuard,
  updateTimestamp = new Date().toISOString(),
) {
  const correctedAt = updateTimestamp;
  const { correctionHistory } = buildObservedAtCorrection(observation, observedAt, reason, correctedAt);
  const updatedAt = correctedAt;
  await updateSheetRanges(
    accessToken,
    teacher.spreadsheetId,
    [
      {
        range: `${quoteSheetTitle(teacher.sheetTitle)}!N${observation.rowNumber}:P${observation.rowNumber}`,
        values: [[observedAt, correctedAt, correctionHistory]],
      },
      { range: `${quoteSheetTitle(teacher.sheetTitle)}!S${observation.rowNumber}`, values: [[updatedAt]] },
    ],
    guard,
  );
  return { observedAt, correctedAt, correctionHistory, updatedAt };
}

export function buildObservedAtCorrection(
  observation: DriveObservation,
  observedAt: string,
  reason: string,
  correctedAt: string,
) {
  const cleanReason = reason.replace(/[\r\n\t]+/g, " ").trim();
  const historyLine = `${correctedAt} | ${observation.observedAt} → ${observedAt} | ${cleanReason}`;
  return {
    correctionHistory: observation.correctionHistory
      ? `${observation.correctionHistory}\n${historyLine}`
      : historyLine,
  };
}

export async function updateObservationFeedback(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
  teacherFeedback: string,
  guard?: SheetWriteGuard,
  updateTimestamp = new Date().toISOString(),
) {
  const updatedAt = updateTimestamp;
  await updateSheetValues(
    accessToken,
    teacher.spreadsheetId,
    `${quoteSheetTitle(teacher.sheetTitle)}!R${observation.rowNumber}:S${observation.rowNumber}`,
    [[teacherFeedback, updatedAt]],
    "RAW",
    guard,
  );
  await upsertObservationIndex(teacher, observation.id, observation.rowNumber).catch(() => undefined);
  return { teacherFeedback, updatedAt };
}

export async function deleteObservation(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
  guard?: SheetWriteGuard,
) {
  await updateObservationStatus(accessToken, teacher, observation, "hidden", guard);
  const deletePhoto = () => deleteDriveFile(accessToken, observation.imageFileId);
  await (guard ? guard.writeGoogle(deletePhoto) : deletePhoto());
  const deleteRow = () => googleJson(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: teacher.sheetId,
                dimension: "ROWS",
                startIndex: observation.rowNumber - 1,
                endIndex: observation.rowNumber,
              },
            },
          },
        ],
      }),
    },
  );
  await (guard ? guard.writeGoogle(deleteRow) : deleteRow());
  await deleteObservationIndex(teacher.id, observation.id);
  // 행 삭제는 아래 모든 행 번호를 바꾸므로 시트 단위로 색인만 비웁니다.
  await clearObservationIndexes(teacher.id);
}

export async function downloadObservationImage(
  accessToken: string,
  teacher: TeacherConnection,
  fileId: string,
) {
  const metadata = await googleJson<DriveFile>(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({
      fields: "id,mimeType,parents,trashed",
    })}`,
    accessToken,
  );
  if (
    !metadata.id ||
    metadata.trashed ||
    !metadata.parents?.includes(teacher.photosFolderId) ||
    !/^image\/(jpeg|png|webp)$/.test(metadata.mimeType || "")
  ) {
    throw new HttpError(404, "사진 파일을 찾을 수 없습니다.");
  }
  return googleFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
}

export async function revokeGoogleToken(token: string) {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}
