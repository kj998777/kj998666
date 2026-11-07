"use server";

import { redirect } from "next/navigation";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createAuthCode, getClient, isStaffRole } from "@/lib/mcp/oauth";
import { authorizeParamsProblem, readAuthorizeParams, redirectWith } from "@/lib/mcp/oauthCore";

// 메딕차트 MCP 커넥터 승인(0059) — 화면(page.tsx)에서 보여 준 값을 여기서 처음부터 다시 검사한 뒤에만 코드를 만든다.
export async function decideAuthorize(formData: FormData) {
  const sp = new URLSearchParams();
  for (const k of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]) {
    sp.set(k, String(formData.get(k) ?? ""));
  }
  const p = readAuthorizeParams(sp);
  if (authorizeParamsProblem(p)) redirect("/oauth/authorize?" + sp.toString());
  const client = await getClient(p.client_id);
  if (!client || !client.redirect_uris.includes(p.redirect_uri)) redirect("/oauth/authorize?" + sp.toString());

  if (formData.get("decision") !== "allow") {
    redirect(redirectWith(p.redirect_uri, { error: "access_denied", error_description: "사용자가 연결을 거절했습니다.", state: p.state }));
  }
  const session = await getSessionAndRole();
  if (!session) redirect("/login?next=" + encodeURIComponent("/oauth/authorize?" + sp.toString()));
  if (!isStaffRole(session.role)) redirect("/oauth/authorize?" + sp.toString());

  const code = await createAuthCode({
    clientId: client.client_id,
    userId: session.userId,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    scope: p.scope,
  });
  redirect(redirectWith(p.redirect_uri, { code, state: p.state }));
}
