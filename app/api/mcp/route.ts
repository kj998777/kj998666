import { verifyAccessToken } from "@/lib/mcp/oauth";
import { CORS_HEADERS, json, originOf, preflight } from "@/lib/mcp/http";
import { callTool, toolListing } from "@/lib/mcp/tools";

// 메딕차트 MCP 서버(0059) — claude.ai 커스텀 커넥터가 부르는 주소: https://medicchart.vercel.app/api/mcp
// Streamable HTTP의 JSON 응답 방식(세션·SSE 없음). 매 요청 Authorization: Bearer <access_token>(OAuth, lib/mcp/oauth.ts).
// 토큰이 없거나 끊겼으면 401 + WWW-Authenticate(resource_metadata) → claude.ai가 OAuth 연결을 시작한다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "medicchart", title: "메딕차트", version: "1.0.0" };
const INSTRUCTIONS =
  "메딕차트(제주 수학학원 시험·채점 관리) 도구. 시험은 code로 가리킨다 — 모르면 search_exams부터. " +
  "모의고사 올리기 순서: create_exam(mock=true, 닫힘으로 생김) → upload_exam_pdf(problem, solution) → set_mock_answers → set_grade_cuts → set_solution_pages → 관리자가 set_exam_status(open=true). " +
  "학교 시험 정답표는 set_answer_key, 해설은 update_item. 지우는 도구는 없고, 모든 호출은 기록된다. 학생 이름·점수는 학원 밖으로 옮기지 말 것.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const rpcErr = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function unauthorized(request: Request, desc = "메딕차트 계정으로 연결해 주세요.") {
  const origin = originOf(request);
  return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: desc } }, 401, {
    // 머리말 값은 Latin-1만 된다(한글을 넣으면 Response를 만들 때 TypeError → 500). 한국어 안내는 본문에만.
    "WWW-Authenticate": `Bearer realm="medicchart", resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Sign in with a Medicchart staff account"`,
  });
}

export async function POST(request: Request) {
  const auth = await verifyAccessToken(request.headers.get("authorization"));
  if (!auth) return unauthorized(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcErr(null, -32700, "JSON을 읽지 못했습니다."), 400);
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Rpc[];
  if (!msgs.length) return json(rpcErr(null, -32600, "빈 요청입니다."), 400);
  const ctx = { auth, origin: originOf(request) };

  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || typeof m.method !== "string") {
      out.push(rpcErr(m?.id, -32600, "잘못된 요청입니다."));
      continue;
    }
    const isNote = m.id === undefined || m.id === null;
    try {
      const result = await handle(m, ctx);
      if (!isNote) out.push({ jsonrpc: "2.0", id: m.id, result });
    } catch (e: any) {
      if (!isNote) out.push(rpcErr(m.id, e?.code ?? -32603, String(e?.message ?? e)));
    }
  }
  if (!out.length) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(batch ? out : out[0]);
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

async function handle(m: Rpc, ctx: { auth: NonNullable<Awaited<ReturnType<typeof verifyAccessToken>>>; origin: string }) {
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS + ` (연결 계정: ${ctx.auth.email || "?"}, 역할: ${ctx.auth.role})`,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolListing(ctx.auth.role) };
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      if (!name) throw new RpcError(-32602, "도구 이름(name)이 없습니다.");
      return callTool(name, m.params?.arguments ?? {}, ctx);
    }
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      if (m.method?.startsWith("notifications/")) return {};
      throw new RpcError(-32601, `지원하지 않는 메서드입니다: ${m.method}`);
  }
}

// 서버에서 먼저 보내는 알림(SSE)은 쓰지 않는다
export async function GET(request: Request) {
  const auth = await verifyAccessToken(request.headers.get("authorization"));
  if (!auth) return unauthorized(request);
  return new Response("SSE는 지원하지 않습니다.", { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export const OPTIONS = preflight;
