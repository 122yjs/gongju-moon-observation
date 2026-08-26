import { createTeacherCookie, getTeacherSession } from "../../../../lib/auth";
import { randomToken, sha256Hex } from "../../../../lib/crypto";
import {
  createClassRootFolder,
  deleteDriveFile,
  getTeacherAccessToken,
  initializeTeacherDrive,
} from "../../../../lib/google-drive";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import {
  createTeacherClass,
  getTeacherAccountById,
  getTeacherById,
  listTeacherClasses,
} from "../../../../lib/tenant";

async function requireTeacher(request: Request) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  return teacher;
}

function normalizeClassLabel(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "학급명을 입력해 주세요.");
  const normalized = value.normalize("NFC").trim();
  if (normalized.length < 1 || Array.from(normalized).length > 40 || /\p{Cc}/u.test(normalized)) {
    throw new HttpError(400, "학급명은 1자부터 40자까지 입력해 주세요.");
  }
  return normalized;
}

function classLinks(teacherClass: Awaited<ReturnType<typeof listTeacherClasses>>[number]) {
  return {
    id: teacherClass.id,
    classLabel: teacherClass.classLabel,
    rootFolderUrl: `https://drive.google.com/drive/folders/${teacherClass.rootFolderId}`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${teacherClass.spreadsheetId}/edit`,
    createdAt: teacherClass.createdAt,
    updatedAt: teacherClass.updatedAt,
  };
}

async function responseFor(accountId: string, activeClassId: string) {
  const classes = await listTeacherClasses(accountId);
  return {
    activeClassId,
    classes: classes.map(classLinks),
  };
}

export async function GET(request: Request) {
  try {
    const teacher = await requireTeacher(request);
    return json(await responseFor(teacher.accountId, teacher.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let accessToken: string | null = null;
  let rootFolderId: string | null = null;
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const account = await getTeacherAccountById(teacher.accountId);
    if (!account) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
    const payload = (await request.json().catch(() => ({}))) as { classLabel?: unknown };
    const classLabel = normalizeClassLabel(payload.classLabel);
    accessToken = await getTeacherAccessToken(teacher);
    rootFolderId = await createClassRootFolder(accessToken, classLabel);
    const resources = await initializeTeacherDrive(accessToken, rootFolderId);
    const inviteToken = randomToken(32);
    const created = await createTeacherClass({
      account,
      ...resources,
      inviteToken,
      inviteTokenHash: await sha256Hex(inviteToken),
      classLabel,
    });
    rootFolderId = null;
    return json(
      {
        ok: true,
        ...(await responseFor(created.accountId, created.id)),
      },
      { headers: { "Set-Cookie": await createTeacherCookie(created.id) } },
    );
  } catch (error) {
    if (accessToken && rootFolderId) {
      await deleteDriveFile(accessToken, rootFolderId).catch(() => undefined);
    }
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const payload = (await request.json().catch(() => ({}))) as { classId?: unknown };
    if (typeof payload.classId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.classId)) {
      throw new HttpError(400, "전환할 반을 확인해 주세요.");
    }
    const target = await getTeacherById(payload.classId);
    if (!target || target.accountId !== teacher.accountId) {
      throw new HttpError(404, "같은 Google 계정의 반을 찾지 못했습니다.");
    }
    return json(
      {
        ok: true,
        ...(await responseFor(target.accountId, target.id)),
      },
      { headers: { "Set-Cookie": await createTeacherCookie(target.id) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
