import { clearTeacherCookie, getTeacherSession } from "../../../../lib/auth";
import { revokeGoogleToken, withSheetWriteLocks } from "../../../../lib/google-drive";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import {
  deleteTeacherAccount,
  getTeacherById,
  listTeacherConnections,
  revealRefreshToken,
} from "../../../../lib/tenant";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getTeacherSession(request);
    if (!session?.teacherId) throw new HttpError(401, "교사 로그인이 필요합니다.");
    const teacher = await getTeacherById(session.teacherId);
    if (teacher) {
      const refreshToken = await revealRefreshToken(teacher);
      const teachers = await listTeacherConnections(teacher.accountId);
      await withSheetWriteLocks(teachers, "disconnect", async (guards) => {
        const revokeAndDelete = async (index: number): Promise<void> => {
          if (index >= guards.length) {
            await revokeGoogleToken(refreshToken);
            await deleteTeacherAccount(teacher.accountId);
            return;
          }
          await guards[index].writeGoogle(() => revokeAndDelete(index + 1));
        };
        await revokeAndDelete(0);
      });
    }
    return json(
      {
        ok: true,
        message: "이 Google 계정의 중앙 연결을 해제했습니다. 교사 Google Drive의 반별 사진과 제출 목록은 그대로 남습니다.",
      },
      { headers: { "Set-Cookie": clearTeacherCookie() } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
