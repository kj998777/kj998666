// 메딕차트 MCP 커넥터(0059) — OAuth 2.1 계산만 모은 순수 함수(test/mcpOauth.test.ts).
// DB를 만지는 쪽은 lib/mcp/oauth.ts, 화면·라우트는 app/oauth/authorize, app/api/oauth/*, app/api/mcp.
import { createHash, randomBytes } from "node:crypto";

export const ACCESS_TTL_SEC = 60 * 60; // 1시간
export const REFRESH_TTL_SEC = 60 * 24 * 3600; // 60일(쓸 때마다 새로 바꿈)
export const CODE_TTL_SEC = 10 * 60; // 승인 코드 10분
export const MCP_SCOPE = "medicchart";

/** URL에 그대로 넣을 수 있는 임의 문자열(base64url, 기본 32바이트 = 43자) */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 토큰·코드는 원문 대신 sha256(hex)만 저장한다 */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** PKCE S256: base64url(sha256(code_verifier)) === code_challenge */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  const v = String(verifier ?? "");
  // RFC 7636: 43~128자, [A-Z a-z 0-9 - . _ ~]
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(v)) return false;
  return pkceS256(v) === challenge;
}

/**
 * 돌려보낼 주소(redirect_uri) 허용 목록 — claude.ai·claude.com(웹·앱·Cowork 커넥터)과 내 컴퓨터(localhost, Claude Code 등)만.
 * 아무 사이트나 등록하게 두면, 가짜 사이트가 승인 화면 링크를 보내 직원 토큰을 받아 가는 피싱에 쓰일 수 있다.
 */
export function redirectUriAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") {
    const h = u.hostname.toLowerCase();
    return h === "claude.ai" || h === "claude.com" || h.endsWith(".claude.ai") || h.endsWith(".claude.com");
  }
  if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  return false;
}

/** 클라이언트 등록 요청(RFC 7591) 검사 — 통과하면 저장할 값, 아니면 오류 문구 */
export function validateRegistration(body: unknown): { ok: true; client_name: string; redirect_uris: string[] } | { ok: false; error: string; description: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map((x) => String(x)) : [];
  if (!uris.length || uris.length > 10) return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris가 필요합니다(1~10개)." };
  const bad = uris.find((u) => !redirectUriAllowed(u));
  if (bad) return { ok: false, error: "invalid_redirect_uri", description: `허용하지 않는 주소입니다: ${bad.slice(0, 100)} (claude.ai·claude.com·localhost만)` };
  const name = String(b.client_name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return { ok: true, client_name: name || "Claude", redirect_uris: uris };
}

export type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  resource: string;
};

export function readAuthorizeParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): AuthorizeParams {
  const get = (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? "";
    const v = (sp as Record<string, string | string[] | undefined>)[k];
    return Array.isArray(v) ? v[0] ?? "" : v ?? "";
  };
  return {
    response_type: get("response_type"),
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method") || "S256",
    state: get("state"),
    scope: get("scope"),
    resource: get("resource"),
  };
}

/** 승인 화면에 들어온 값 검사(클라이언트·주소는 DB와 따로 대조) — 문제 없으면 null */
export function authorizeParamsProblem(p: AuthorizeParams): string | null {
  if (p.response_type !== "code") return "response_type은 code여야 합니다.";
  if (!p.client_id) return "client_id가 없습니다.";
  if (!p.redirect_uri) return "redirect_uri가 없습니다.";
  if (p.code_challenge_method !== "S256") return "PKCE(S256)만 지원합니다.";
  if (!/^[A-Za-z0-9\-_]{43}$/.test(p.code_challenge)) return "code_challenge가 올바르지 않습니다.";
  if (p.state.length > 2000) return "state가 너무 깁니다.";
  return null;
}

/** 승인 결과를 돌려보낼 주소(redirect_uri?code=…&state=… 또는 error=…) */
export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/** OAuth 메타데이터(RFC 8414 / RFC 9728) */
export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    service_documentation: `${origin}/admin/mcp`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
    resource_name: "메딕차트",
  };
}
