import { authServerMetadata, protectedResourceMetadata } from "@/lib/mcp/oauthCore";
import { registerClient, revokeByToken, tokenEndpoint } from "@/lib/mcp/oauth";
import { CORS_HEADERS, json, originOf, preflight, readParams } from "@/lib/mcp/http";

// 메딕차트 MCP 커넥터의 OAuth 2.1 주소(0059, 2026-11-07) — 한 파일에 모았다.
//   GET  /api/oauth/metadata  ← /.well-known/oauth-authorization-server (next.config.mjs rewrites, RFC 8414)
//   GET  /api/oauth/resource  ← /.well-known/oauth-protected-resource (RFC 9728) — /api/mcp를 지키는 OAuth 서버 안내
//   POST /api/oauth/register  동적 클라이언트 등록(RFC 7591). claude.ai가 처음 연결할 때 스스로 부른다.
//                             돌려보낼 주소는 claude.ai·claude.com·localhost만(lib/mcp/oauthCore.ts redirectUriAllowed).
//   POST /api/oauth/token     승인 코드(PKCE) → access·refresh 토큰 / refresh → 새 토큰 한 벌(예전 것은 무효)
//   POST /api/oauth/revoke    토큰이 속한 연결을 끊는다(RFC 7009, 모르는 토큰이어도 200)
// 승인 화면은 app/oauth/authorize.

export const dynamic = "force-dynamic";
type Ctx = { params: { action: string } };

const notFound = () => json({ error: "not_found" }, 404);

export function GET(request: Request, { params }: Ctx) {
  if (params.action === "metadata") return json(authServerMetadata(originOf(request)));
  if (params.action === "resource") return json(protectedResourceMetadata(originOf(request)));
  return notFound();
}

export async function POST(request: Request, { params }: Ctx) {
  if (params.action === "register") {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_client_metadata", error_description: "JSON 본문이 필요합니다." }, 400);
    }
    const r: any = await registerClient(body);
    if (r.error) return json({ error: r.error, error_description: r.error_description }, r.status ?? 400);
    return json(r, 201);
  }
  if (params.action === "token") {
    const r: any = await tokenEndpoint(await readParams(request));
    if (r.error) return json({ error: r.error, error_description: r.error_description }, r.status ?? 400);
    return json(r);
  }
  if (params.action === "revoke") {
    const p = await readParams(request);
    await revokeByToken(p.token ?? "");
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  return notFound();
}

export const OPTIONS = preflight;
