const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function json(
  body: unknown,
  init: ResponseInit & { headers?: HeadersInit } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "허용되지 않은 요청입니다.");
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ message: error.message }, { status: error.status });
  }
  console.error(error);
  return json(
    { message: "서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}
