import { getAdminSession } from "../../../../lib/auth";
import { errorResponse, HttpError, json } from "../../../../lib/http";
import { getClassLabel, getEnv } from "../../../../lib/runtime";

export async function GET(request: Request) {
  try {
    if (!(await getAdminSession(request))) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const runtime = getEnv();
    const url = new URL(request.url);
    const joinUrl = `${url.origin}/join?t=${encodeURIComponent(runtime.CLASS_INVITE_TOKEN)}`;
    return json({ joinUrl, classLabel: getClassLabel(runtime) });
  } catch (error) {
    return errorResponse(error);
  }
}
