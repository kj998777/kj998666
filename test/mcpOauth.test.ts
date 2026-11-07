// 메딕차트 MCP 커넥터 OAuth 계산(lib/mcp/oauthCore.ts) — node --experimental-strip-types test/mcpOauth.test.ts
import assert from "node:assert/strict";
import {
  authorizeParamsProblem,
  authServerMetadata,
  pkceS256,
  protectedResourceMetadata,
  randomToken,
  readAuthorizeParams,
  redirectUriAllowed,
  redirectWith,
  sha256Hex,
  validateRegistration,
  verifyPkce,
} from "../lib/mcp/oauthCore";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

check("PKCE S256: openssl dgst -sha256 | base64url 값과 같음", () => {
  const v = "dBjftJeZ4CVP-mJ92K1qUuMnoBQo5Atcw7TBuGShSo0";
  assert.equal(pkceS256(v), "o51sGoJPoCw5tmHqXLz2lDHmDO-202Xv1KyKtOa0aoY");
  assert.equal(verifyPkce(v, "o51sGoJPoCw5tmHqXLz2lDHmDO-202Xv1KyKtOa0aoY"), true);
  assert.equal(verifyPkce(v, "o51sGoJPoCw5tmHqXLz2lDHmDO-202Xv1KyKtOa0aoX"), false);
  assert.equal(verifyPkce("short", pkceS256("short")), false); // 43자 미만
  assert.equal(verifyPkce(undefined, "x"), false);
  assert.equal(verifyPkce("a".repeat(129), pkceS256("a".repeat(129))), false);
});

check("임의 토큰·해시", () => {
  const t = randomToken();
  assert.equal(t.length, 43);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(randomToken(), t);
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

check("돌려보낼 주소: claude.ai·claude.com·localhost만", () => {
  assert.equal(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectUriAllowed("https://claude.com/api/mcp/auth_callback"), true);
  assert.equal(redirectUriAllowed("https://www.claude.ai/cb"), true);
  assert.equal(redirectUriAllowed("http://localhost:6274/oauth/callback"), true);
  assert.equal(redirectUriAllowed("http://127.0.0.1:33418/callback"), true);
  assert.equal(redirectUriAllowed("http://claude.ai/cb"), false); // http는 localhost만
  assert.equal(redirectUriAllowed("https://claude.ai.evil.com/cb"), false);
  assert.equal(redirectUriAllowed("https://evilclaude.ai/cb"), false);
  assert.equal(redirectUriAllowed("https://claude.ai/cb#frag"), false);
  assert.equal(redirectUriAllowed("javascript:alert(1)"), false);
  assert.equal(redirectUriAllowed("not a url"), false);
});

check("클라이언트 등록 검사", () => {
  const ok = validateRegistration({ client_name: "  Claude   ", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  assert.deepEqual(ok, { ok: true, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  const noName = validateRegistration({ redirect_uris: ["https://claude.ai/cb"] });
  assert.equal(noName.ok && noName.client_name, "Claude");
  assert.equal(validateRegistration({}).ok, false);
  assert.equal(validateRegistration(null).ok, false);
  assert.equal(validateRegistration({ redirect_uris: ["https://claude.ai/cb", "https://evil.com/cb"] }).ok, false);
  assert.equal(validateRegistration({ redirect_uris: Array(11).fill("https://claude.ai/cb") }).ok, false);
});

check("승인 화면 값 검사", () => {
  const sp = new URLSearchParams({
    response_type: "code",
    client_id: "mc_x",
    redirect_uri: "https://claude.ai/cb",
    code_challenge: pkceS256("dBjftJeZ4CVP-mJ92K1qUuMnoBQo5Atcw7TBuGShSo0"),
    code_challenge_method: "S256",
    state: "st",
  });
  const p = readAuthorizeParams(sp);
  assert.equal(authorizeParamsProblem(p), null);
  assert.equal(readAuthorizeParams({ client_id: ["a", "b"] }).client_id, "a");
  assert.equal(readAuthorizeParams({}).code_challenge_method, "S256"); // 빠지면 S256로 봄
  assert.notEqual(authorizeParamsProblem({ ...p, response_type: "token" }), null);
  assert.notEqual(authorizeParamsProblem({ ...p, code_challenge_method: "plain" }), null);
  assert.notEqual(authorizeParamsProblem({ ...p, code_challenge: "abc" }), null);
  assert.notEqual(authorizeParamsProblem({ ...p, client_id: "" }), null);
});

check("돌려보내기 주소 만들기", () => {
  assert.equal(redirectWith("https://claude.ai/cb?x=1", { code: "c d", state: "s" }), "https://claude.ai/cb?x=1&code=c+d&state=s");
  assert.equal(redirectWith("https://claude.ai/cb", { error: "access_denied", state: "" }), "https://claude.ai/cb?error=access_denied");
});

check("메타데이터", () => {
  const m = authServerMetadata("https://medicchart.vercel.app");
  assert.equal(m.issuer, "https://medicchart.vercel.app");
  assert.equal(m.token_endpoint, "https://medicchart.vercel.app/api/oauth/token");
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  const r = protectedResourceMetadata("https://medicchart.vercel.app");
  assert.equal(r.resource, "https://medicchart.vercel.app/api/mcp");
  assert.deepEqual(r.authorization_servers, ["https://medicchart.vercel.app"]);
});

console.log(`mcpOauth: ${n}개 통과`);
