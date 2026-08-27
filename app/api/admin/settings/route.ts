import { getTeacherSession } from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getTeacherById, updateAccountRegionSettings, updateClassLabel } from "../../../../lib/tenant";

async function requireTeacher(request: Request) {
  const session = await getTeacherSession(request);
  if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
  const teacher = await getTeacherById(session.teacherId);
  if (!teacher) throw new HttpError(401, "Google Drive를 다시 연결해 주세요.");
  return teacher;
}

export async function GET(request: Request) {
  try {
    const teacher = await requireTeacher(request);
    return json({
      classLabel: teacher.classLabel,
      regionLabel: teacher.regionLabel,
      regionShortLabel: teacher.regionShortLabel,
      observationLat: teacher.observationLat,
      observationLon: teacher.observationLon,
      regionSettingsRequired: !teacher.regionSettingsCompletedAt,
      googleDisplayName: teacher.googleDisplayName,
      googleEmail: teacher.googleEmail,
      rootFolderUrl: `https://drive.google.com/drive/folders/${teacher.rootFolderId}`,
      spreadsheetUrl: `/api/admin/spreadsheet?classId=${encodeURIComponent(teacher.id)}`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const teacher = await requireTeacher(request);
    const payload = (await request.json()) as {
      classLabel?: unknown;
      regionLabel?: unknown;
      regionShortLabel?: unknown;
      observationLat?: unknown;
      observationLon?: unknown;
    };
    const result: {
      ok: true;
      classLabel?: string;
      regionLabel?: string;
      regionShortLabel?: string;
      observationLat?: number;
      observationLon?: number;
      regionSettingsRequired?: boolean;
    } = { ok: true };
    if ("classLabel" in payload) {
      if (typeof payload.classLabel !== "string") throw new HttpError(400, "학급명을 입력해 주세요.");
      result.classLabel = await updateClassLabel(teacher.id, payload.classLabel);
    }
    const hasRegionPayload =
      "regionLabel" in payload ||
      "regionShortLabel" in payload ||
      "observationLat" in payload ||
      "observationLon" in payload;
    if (hasRegionPayload) {
      const region = await updateAccountRegionSettings(teacher.accountId, {
        regionLabel: payload.regionLabel,
        regionShortLabel: payload.regionShortLabel,
        observationLat: payload.observationLat,
        observationLon: payload.observationLon,
      });
      result.regionLabel = region.regionLabel;
      result.regionShortLabel = region.regionShortLabel;
      result.observationLat = region.observationLat;
      result.observationLon = region.observationLon;
      result.regionSettingsRequired = !region.regionSettingsCompletedAt;
    }
    if (!("classLabel" in payload) && !hasRegionPayload) {
      throw new HttpError(400, "저장할 설정을 입력해 주세요.");
    }
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
