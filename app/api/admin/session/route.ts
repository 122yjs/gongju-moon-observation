import { clearTeacherCookie, getTeacherSession } from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, json } from "../../../../lib/http";
import { getTeacherById } from "../../../../lib/tenant";

export async function GET(request: Request) {
  try {
    const session = await getTeacherSession(request);
    const teacher = session?.teacherId ? await getTeacherById(session.teacherId) : null;
    if (!teacher) {
      return json(
        { authenticated: false },
        session ? { headers: { "Set-Cookie": clearTeacherCookie() } } : {},
      );
    }
    return json({
      authenticated: true,
      teacher: {
        id: teacher.id,
        accountId: teacher.accountId,
        displayName: teacher.googleDisplayName,
        email: teacher.googleEmail,
        classLabel: teacher.classLabel,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  return json(
    { message: "교사 로그인은 Google Drive 연결 버튼을 이용해 주세요." },
    { status: 405, headers: { Allow: "GET, DELETE" } },
  );
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ ok: true }, { headers: { "Set-Cookie": clearTeacherCookie() } });
  } catch (error) {
    return errorResponse(error);
  }
}
