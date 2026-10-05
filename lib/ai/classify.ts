import "server-only";
import { adaptParamsForModel, aiCreditKind, aiErr, anthropicCall } from "./anthropic";
import { getAiCreds, recordUsage } from "./settings";
import { LOGIC_SUBJECTS, logicTypeListFor, validLogicType } from "@/lib/similar/logicTypes";

// 논리 유형이 비어 있는 문항을 AI로 한꺼번에 분류(2026-10-05 원장님 "유형처리가 안 되는 것들 모아서 한번에 유형 처리할
// 수 있게끔 탭"). 시험지 PDF 없이 문항 요약·풀이 글만 보고 고르므로 빠르고 싸다(문항 10개씩 한 번에).
// 관리자 화면 /admin/logic-types 가 시험마다 이 함수를 여러 번 불러 남은 문항이 없을 때까지 돌린다.

type Client = any;

export const CLASSIFY_TOOL = {
  name: "assign_logic_types",
  description: "문항마다 논리 유형 코드를 하나씩 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "아래 목록의 문항 id 그대로" },
            logic_type: { type: "string", description: "유형표 맨 앞의 코드 그대로(예 c2.D1)" },
          },
          required: ["id", "logic_type"],
        },
      },
    },
    required: ["items"],
  },
};

export type ClassifyItem = { id: string; label: string; unit: string; statement: string; solution: string };

/** 한 번에 보낼 문항 수 — 서버 실행 시간(60초) 안에 끝나도록 */
export const CLASSIFY_CHUNK = 10;

const clip = (s: string, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function classifyItems(
  client: Client,
  items: ClassifyItem[],
  subject: string
): Promise<{ ok: true; result: Record<string, string> } | { ok: false; msg: string }> {
  if (!LOGIC_SUBJECTS[subject]) return { ok: false, msg: "유형표가 없는 과목입니다." };
  if (!items.length) return { ok: true, result: {} };
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 없습니다. AI 설정에서 먼저 저장해 주세요." };

  // 문항 id(uuid)는 길어서 AI가 틀리게 옮길 수 있으므로 짧은 번호(k1, k2, …)로 바꿔 보낸다
  const key = (i: number) => "k" + (i + 1);
  const list = items
    .map(
      (it, i) =>
        `### id ${key(i)} (${/^\d/.test(it.label) ? it.label + "번" : it.label})\n단원: ${clip(it.unit, 60) || "-"}\n문제: ${clip(it.statement, 700) || "-"}\n풀이: ${clip(it.solution, 900) || "-"}`
    )
    .join("\n\n");
  const prompt = [
    `한국 ${LOGIC_SUBJECTS[subject]} 시험 문항들의 "논리 유형"을 정해 ${CLASSIFY_TOOL.name} 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요.`,
    "",
    "규칙",
    "- 단원 이름이 아니라 '이 문항을 풀 때 쓰는 핵심 논리(어떤 생각으로 푸는가)'에 가장 가까운 유형 하나를 고릅니다.",
    "- 여러 논리가 섞였으면 가장 결정적인 단계(학생이 막히는 지점)의 유형을 고릅니다. 딱 맞는 것이 없으면 가장 가까운 것을 고릅니다(표에 \"기타\"가 있으면 단원 밖 문항은 기타).",
    "- 모든 문항에 대해 id와 유형표 맨 앞의 코드를 그대로 적습니다.",
    "",
    "유형표(코드 | 단원 · 이름 | 설명):",
    logicTypeListFor(subject),
    "",
    "문항:",
    list,
  ].join("\n");

  const params = adaptParamsForModel({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });
  const r = await anthropicCall("post", "/v1/messages", apiKey, params);
  if (r.status !== 200 || !r.json) {
    const kind = aiCreditKind(r);
    return { ok: false, msg: kind === "credit" ? "AI 크레딧이 부족합니다." : kind === "limit" ? "AI 사용 한도에 걸렸습니다." : "AI 요청 실패: " + aiErr(r) };
  }
  const u = r.json.usage;
  if (u) {
    const di = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    await recordUsage(client, model, di, u.output_tokens || 0).catch(() => {});
  }
  const use = (r.json.content as any[] | undefined)?.find((c) => c?.type === "tool_use" && c.name === CLASSIFY_TOOL.name);
  const got: any[] = Array.isArray(use?.input?.items) ? use.input.items : [];
  const byKey = new Map(items.map((it, i) => [key(i), it.id]));
  const result: Record<string, string> = {};
  for (const g of got) {
    const id = byKey.get(String(g?.id ?? "").trim().toLowerCase());
    const lt = validLogicType(g?.logic_type, subject);
    if (id && lt) result[id] = lt;
  }
  return { ok: true, result };
}
