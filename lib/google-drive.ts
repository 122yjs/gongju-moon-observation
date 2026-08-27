import { HttpError } from "./http";
import {
  TeacherConnection,
  revealAccessToken,
  revealRefreshToken,
  updateTeacherAccessToken,
} from "./tenant";
import { requireOAuthConfig } from "./tenant";

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
}

export interface DriveObservation {
  id: string;
  requestId: string;
  classLabel: string;
  studentNumber: number;
  studentName: string;
  observedAt: string;
  memo: string;
  imageFileId: string;
  imageType: string;
  imageBytes: number;
  status: "visible" | "hidden";
  createdAt: string;
  imageWebViewUrl: string;
  rowNumber: number;
}

export interface ObservationPage {
  items: DriveObservation[];
  total: number;
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
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
    throw new HttpError(response.status >= 500 ? 502 : response.status, normalizeGoogleError(payload, response.status));
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
) {
  const query = new URLSearchParams({ valueInputOption });
  await googleJson(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
    { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) },
  );
}

async function batchUpdateSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
) {
  return googleJson<BatchUpdateSpreadsheetResponse>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    accessToken,
    { method: "POST", body: JSON.stringify({ requests }) },
  );
}

async function renameAndFormatSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  title: string,
) {
  await googleJson(
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
}

function summaryFormula(rawSheetTitle: string) {
  const raw = quoteSheetTitle(rawSheetTitle);
  const endRow = MAX_SHEET_ROWS + 1;
  return `=ARRAYFORMULA(IFERROR(SORT(FILTER({${raw}!E2:E${endRow},${raw}!D2:D${endRow},SUBSTITUTE(${raw}!F2:F${endRow},"T"," "),${raw}!G2:G${endRow},IF(${raw}!J2:J${endRow}="","",ROUND(${raw}!J2:J${endRow}/1048576,2)&" MB"),IF(${raw}!M2:M${endRow}="","",HYPERLINK(${raw}!M2:M${endRow},"사진 열기"))},${raw}!A2:A${endRow}<>"",${raw}!K2:K${endRow}="visible"),3,FALSE),""))`;
}

export async function ensureTeacherSummarySheet(
  accessToken: string,
  teacher: Pick<TeacherDriveResources, "spreadsheetId" | "sheetId" | "sheetTitle">,
) {
  const fields = [
    "properties(timeZone)",
    "sheets(properties(sheetId,title,index,hidden),protectedRanges(protectedRangeId,description,warningOnly,range(sheetId)))",
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
            columnCount: 6,
            frozenRowCount: 1,
          },
        },
      },
    });
  } else {
    setupRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: summarySheet.properties.sheetId,
          index: 0,
          hidden: false,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "index,hidden,gridProperties.frozenRowCount",
      },
    });
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
  await updateSheetValues(
    accessToken,
    teacher.spreadsheetId,
    `${summaryTitle}!A1:F1`,
    [["이름", "출석번호", "관찰 시각 (한국 시간)", "설명", "사진 용량", "사진 원본 링크"]],
  );
  await updateSheetValues(
    accessToken,
    teacher.spreadsheetId,
    `${summaryTitle}!A2`,
    [[summaryFormula(rawSheet.properties.title)]],
    "USER_ENTERED",
  );

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
    ...[120, 90, 170, 320, 110, 120].map((pixelSize, index) => ({
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
  await batchUpdateSpreadsheet(accessToken, teacher.spreadsheetId, formatRequests);
  return summarySheetId;
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
  await renameAndFormatSheet(accessToken, spreadsheet.id, sheetId, sheetTitle);
  await updateSheetValues(
    accessToken,
    spreadsheet.id,
    `${quoteSheetTitle(sheetTitle)}!A1:M1`,
    [[
      "관찰 ID",
      "요청 ID",
      "학급",
      "번호",
      "이름",
      "관찰 시각",
      "관찰 기록",
      "사진 파일 ID",
      "사진 형식",
      "사진 용량",
      "공개 상태",
      "제출 시각",
      "사진 링크",
    ]],
  );

  await ensureTeacherSummarySheet(accessToken, {
    spreadsheetId: spreadsheet.id,
    sheetId,
    sheetTitle,
  });

  return {
    rootFolderId,
    photosFolderId: photos.id,
    spreadsheetId: spreadsheet.id,
    sheetId,
    sheetTitle,
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
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A:M`;
  const query = new URLSearchParams({
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
  });
  await googleJson(
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
        ]],
      }),
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
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(studentNumber)) return null;
  return {
    id,
    requestId,
    classLabel: cell(row, 2),
    studentNumber,
    studentName: cell(row, 4),
    observedAt: cell(row, 5),
    memo: cell(row, 6),
    imageFileId: cell(row, 7),
    imageType: cell(row, 8) || "image/jpeg",
    imageBytes: Number.isFinite(imageBytes) ? imageBytes : 0,
    status: statusText === "hidden" ? "hidden" : "visible",
    createdAt: cell(row, 11),
    imageWebViewUrl: cell(row, 12),
    rowNumber,
  };
}

async function readObservationRows(accessToken: string, teacher: TeacherConnection) {
  const range = `${quoteSheetTitle(teacher.sheetTitle)}!A2:M${MAX_SHEET_ROWS + 1}`;
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  const response = await googleJson<ValueRange>(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(teacher.spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    accessToken,
  );
  return (response.values || [])
    .map((row, index) => parseObservation(row, index + 2))
    .filter((item): item is DriveObservation => Boolean(item));
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
  return (await readObservationRows(accessToken, teacher)).find((row) => row.id === observationId) || null;
}

export async function updateObservationStatus(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
  status: "visible" | "hidden",
) {
  await updateSheetValues(
    accessToken,
    teacher.spreadsheetId,
    `${quoteSheetTitle(teacher.sheetTitle)}!K${observation.rowNumber}`,
    [[status]],
  );
}

export async function deleteObservation(
  accessToken: string,
  teacher: TeacherConnection,
  observation: DriveObservation,
) {
  await updateObservationStatus(accessToken, teacher, observation, "hidden");
  await deleteDriveFile(accessToken, observation.imageFileId);
  await googleJson(
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
