// 메딕차트 MCP 커넥터(0059) — OAuth·MCP 라우트가 같이 쓰는 응답 도우미.
// claude.ai는 서버에서 부르지만, 브라우저에서 부르는 MCP 클라이언트(검사 도구 등)도 있어 CORS를 연다(토큰은 머리말로만 받으므로 쿠키는 쓰지 않음).

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extra },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** 요청이 들어온 주소의 origin(https://medicchart.vercel.app 등). Vercel 앞단 머리말을 먼저 본다. */
export function originOf(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

/** form(x-www-form-urlencoded) 또는 JSON 본문을 문자열 사전으로 */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (ct.includes("application/json")) {
      const b = (await request.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(b ?? {})) if (v != null) out[k] = String(v);
    } else {
      const text = await request.text();
      for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    }
  } catch {
    /* 빈 본문 */
  }
  return out;
}
