import { getStudentSession } from "../../../../lib/auth";
import { isHeicImage, readHeicCaptureTime } from "../../../../lib/heic";
import { assertSameOrigin, errorResponse, HttpError } from "../../../../lib/http";
import { getEnv } from "../../../../lib/runtime";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;
const MAX_SIDE = 2560;
const PRIMARY_QUALITY = 90;
const FALLBACK_QUALITY = 82;

const RESPONSE_HEADERS: HeadersInit = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Disposition": "inline; filename=moon.jpg",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

async function transformHeic(source: ArrayBuffer, quality: number) {
  const images = getEnv().IMAGES;
  if (!images) throw new HttpError(503, "HEIC 사진 변환 기능을 사용할 수 없습니다.");
  const result = await images.input(new Blob([source]).stream())
    .transform({ width: MAX_SIDE, height: MAX_SIDE, fit: "scale-down", metadata: "none" })
    .output({ format: "image/jpeg", quality, anim: false });
  const response = result.response({ headers: RESPONSE_HEADERS });
  if (!response.ok) throw new HttpError(415, "이 HEIC 사진을 JPEG로 변환하지 못했습니다.");
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("image/jpeg") || bytes.byteLength < 4) {
    throw new HttpError(415, "HEIC 사진 변환 결과를 확인하지 못했습니다.");
  }
  return bytes;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getStudentSession(request);
    if (!session?.teacherId) {
      throw new HttpError(401, "수업 참여 링크로 입장한 뒤 사진을 준비해 주세요.");
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new HttpError(413, "HEIC 원본 사진은 20MB 이하여야 합니다.");

    const source = await request.arrayBuffer();
    if (source.byteLength < 16 || source.byteLength > MAX_SOURCE_BYTES) {
      throw new HttpError(413, "HEIC 원본 사진은 20MB 이하여야 합니다.");
    }
    const bytes = new Uint8Array(source);
    if (!isHeicImage(bytes)) {
      throw new HttpError(415, "일반적인 휴대폰 HEIC/HEIF 정지 사진만 변환할 수 있습니다.");
    }

    const capturedAt = readHeicCaptureTime(bytes);
    let output: ArrayBuffer;
    try {
      output = await transformHeic(source, PRIMARY_QUALITY);
      if (output.byteLength > MAX_OUTPUT_BYTES) output = await transformHeic(source, FALLBACK_QUALITY);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, "이 HEIC 사진을 JPEG로 변환하지 못했습니다. 다른 사진을 선택해 주세요.");
    }
    if (output.byteLength > MAX_OUTPUT_BYTES) {
      throw new HttpError(413, "변환한 사진이 6MB를 넘습니다. 다른 사진을 선택해 주세요.");
    }

    const headers = new Headers(RESPONSE_HEADERS);
    headers.set("Content-Type", "image/jpeg");
    if (capturedAt) headers.set("X-Photo-Captured-At", capturedAt);
    return new Response(output, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
