import { getOperatorSession } from "../../../../lib/auth";
import { assertSameOrigin, errorResponse, HttpError, json } from "../../../../lib/http";
import { getLegacyStudentDataSummary, purgeLegacyStudentDataBatch } from "../../../../lib/legacy";

async function requireOperator(request: Request) {
  if (!(await getOperatorSession(request))) throw new HttpError(401, "운영자 로그인이 필요합니다.");
}

export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return json(await getLegacyStudentDataSummary());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await requireOperator(request);
    return json(await purgeLegacyStudentDataBatch());
  } catch (error) {
    return errorResponse(error);
  }
}
