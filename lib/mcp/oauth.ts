import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCESS_TTL_SEC,
  CODE_TTL_SEC,
  MCP_SCOPE,
  REFRESH_TTL_SEC,
  randomToken,
  sha256Hex,
  validateRegistration,
  verifyPkce,
} from "./oauthCore";

// 메딕차트 MCP 커넥터(0059) — OAuth 표(mcp_oauth_clients·codes·tokens)를 다루는 서버 전용 함수.
// 표는 RLS만 켜고 정책이 없어 서비스롤(createAdminClient)만 읽고 쓴다.

export const STAFF_ROLES = ["admin", "editor", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaffRole = (r: unknown): r is StaffRole => STAFF_ROLES.includes(r as StaffRole);

type OAuthError = { error: string; error_description: string; status: number };
const oerr = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status });

export async function registerClient(body: unknown) {
  const v = validateRegistration(body);
  if (!v.ok) return oerr(v.error, v.description);
  const client_id = "mc_" + randomToken(18);
  const admin: any = createAdminClient();
  const { error } = await (admin.from("mcp_oauth_clients") as any).insert({ client_id, client_name: v.client_name, redirect_uris: v.redirect_uris });
  if (error) return oerr("server_error", "클라이언트를 등록하지 못했습니다.", 500);
  return {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: v.client_name,
    redirect_uris: v.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: MCP_SCOPE,
  };
}

export async function getClient(clientId: string): Promise<{ client_id: string; client_name: string; redirect_uris: string[] } | null> {
  if (!clientId || clientId.length > 100) return null;
  const admin: any = createAdminClient();
  const { data } = (await admin.from("mcp_oauth_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle()) as any;
  return data ?? null;
}

/** 직원이 승인 화면에서 "허용"을 누른 뒤: 1회용 코드(원문)를 만들어 돌려준다 */
export async function createAuthCode(p: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string }): Promise<string> {
  const code = randomToken(32);
  const admin: any = createAdminClient();
  const { error } = await (admin.from("mcp_oauth_codes") as any).insert({
    code_hash: sha256Hex(code),
    client_id: p.clientId,
    user_id: p.userId,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    scope: p.scope || MCP_SCOPE,
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
  });
  if (error) throw new Error("승인 코드를 만들지 못했습니다: " + error.message);
  return code;
}

async function issueTokens(admin: any, userId: string, clientId: string, grantId: string) {
  const access = "mca_" + randomToken(32);
  const refresh = "mcr_" + randomToken(32);
  const now = Date.now();
  const { error } = await (admin.from("mcp_tokens") as any).insert([
    { token_hash: sha256Hex(access), kind: "access", user_id: userId, client_id: clientId, grant_id: grantId, expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString() },
    { token_hash: sha256Hex(refresh), kind: "refresh", user_id: userId, client_id: clientId, grant_id: grantId, expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  await (admin.from("mcp_oauth_clients") as any).update({ last_used_at: new Date().toISOString() }).eq("client_id", clientId);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope: MCP_SCOPE };
}

async function staffRole(admin: any, userId: string): Promise<StaffRole | null> {
  const { data } = (await admin.from("profiles").select("role").eq("id", userId).maybeSingle()) as any;
  return isStaffRole(data?.role) ? data.role : null;
}

/** POST /api/oauth/token 의 본문(form 또는 JSON)을 받아 토큰을 돌려준다 */
export async function tokenEndpoint(params: Record<string, string>): Promise<Record<string, unknown> | OAuthError> {
  const admin: any = createAdminClient();
  const grant = params.grant_type;
  const clientId = params.client_id ?? "";

  if (grant === "authorization_code") {
    const code = params.code ?? "";
    if (!code) return oerr("invalid_request", "code가 없습니다.");
    const { data: row } = (await admin.from("mcp_oauth_codes").select("*").eq("code_hash", sha256Hex(code)).maybeSingle()) as any;
    if (!row) return oerr("invalid_grant", "코드가 올바르지 않습니다.");
    if (row.used_at) return oerr("invalid_grant", "이미 쓴 코드입니다.");
    if (new Date(row.expires_at).getTime() < Date.now()) return oerr("invalid_grant", "코드가 만료됐습니다. 다시 연결해 주세요.");
    if (clientId && clientId !== row.client_id) return oerr("invalid_grant", "client_id가 맞지 않습니다.");
    if (params.redirect_uri && params.redirect_uri !== row.redirect_uri) return oerr("invalid_grant", "redirect_uri가 맞지 않습니다.");
    if (!verifyPkce(params.code_verifier, row.code_challenge)) return oerr("invalid_grant", "PKCE 확인에 실패했습니다.");
    // 한 번만 쓰이게 먼저 표시(동시에 두 번 오면 하나만 통과)
    const { data: used } = (await (admin.from("mcp_oauth_codes") as any)
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", row.code_hash)
      .is("used_at", null)
      .select("code_hash")) as any;
    if (!used?.length) return oerr("invalid_grant", "이미 쓴 코드입니다.");
    if (!(await staffRole(admin, row.user_id))) return oerr("access_denied", "직원(관리자·편집자·열람자) 계정만 연결할 수 있습니다.", 403);
    try {
      return await issueTokens(admin, row.user_id, row.client_id, randomUUID());
    } catch {
      return oerr("server_error", "토큰을 만들지 못했습니다.", 500);
    }
  }

  if (grant === "refresh_token") {
    const rt = params.refresh_token ?? "";
    if (!rt) return oerr("invalid_request", "refresh_token이 없습니다.");
    const { data: row } = (await admin.from("mcp_tokens").select("*").eq("token_hash", sha256Hex(rt)).eq("kind", "refresh").maybeSingle()) as any;
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return oerr("invalid_grant", "연결이 끊겼거나 만료됐습니다. 다시 연결해 주세요.");
    if (clientId && clientId !== row.client_id) return oerr("invalid_grant", "client_id가 맞지 않습니다.");
    // 쓸 때마다 새로 바꾼다(예전 refresh는 바로 무효)
    const { data: rev } = (await (admin.from("mcp_tokens") as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", row.token_hash)
      .is("revoked_at", null)
      .select("token_hash")) as any;
    if (!rev?.length) return oerr("invalid_grant", "이미 쓴 refresh_token입니다.");
    if (!(await staffRole(admin, row.user_id))) return oerr("access_denied", "직원 계정이 아니게 되어 연결을 끊었습니다.", 403);
    try {
      return await issueTokens(admin, row.user_id, row.client_id, row.grant_id);
    } catch {
      return oerr("server_error", "토큰을 만들지 못했습니다.", 500);
    }
  }

  return oerr("unsupported_grant_type", "authorization_code 또는 refresh_token만 됩니다.");
}

export type McpAuth = { userId: string; role: StaffRole; email: string; grantId: string; clientId: string };

/** Authorization: Bearer … 확인 — 직원 역할이 아니거나 끊긴 연결이면 null */
export async function verifyAccessToken(authHeader: string | null): Promise<McpAuth | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? "");
  if (!m) return null;
  const admin: any = createAdminClient();
  const { data: row } = (await admin.from("mcp_tokens").select("token_hash, user_id, client_id, grant_id, expires_at, revoked_at, last_used_at").eq("token_hash", sha256Hex(m[1])).eq("kind", "access").maybeSingle()) as any;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  const { data: prof } = (await admin.from("profiles").select("role, email").eq("id", row.user_id).maybeSingle()) as any;
  if (!isStaffRole(prof?.role)) return null;
  // 마지막 사용 시각(5분에 한 번만 적음)
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60 * 1000) {
    await (admin.from("mcp_tokens") as any).update({ last_used_at: new Date().toISOString() }).eq("token_hash", row.token_hash);
  }
  return { userId: row.user_id, role: prof.role, email: prof.email ?? "", grantId: row.grant_id, clientId: row.client_id };
}

/** 연결 하나(승인 한 번에서 나온 토큰 전부)를 끊는다 */
export async function revokeGrant(grantId: string): Promise<number> {
  const admin: any = createAdminClient();
  const { data } = (await (admin.from("mcp_tokens") as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq("grant_id", grantId)
    .is("revoked_at", null)
    .select("token_hash")) as any;
  return data?.length ?? 0;
}

/** POST /api/oauth/revoke (RFC 7009) — 받은 토큰이 속한 연결을 끊는다. 모르는 토큰이어도 200 */
export async function revokeByToken(token: string): Promise<void> {
  if (!token) return;
  const admin: any = createAdminClient();
  const { data: row } = (await admin.from("mcp_tokens").select("grant_id").eq("token_hash", sha256Hex(token)).maybeSingle()) as any;
  if (row?.grant_id) await revokeGrant(row.grant_id);
}
