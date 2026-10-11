import "server-only";
import { PDFDocument } from "pdf-lib";
import { adaptParamsForModel, aiCreditKind, aiErr, anthropicCall } from "./anthropic";
import { getAiCreds, recordUsage } from "./settings";
import { CHOICE_NOS, COMMON_NOS, cleanAnswer, csatSpec, emptyAnswers, type CsatAnswers } from "@/lib/exams/mockCsat";

// 고3 사설 모의고사 해설지 PDF에서 정답만 읽기(2026-10-11 원장님 선택: "해설지에서 AI가 정답만 읽기").
// 빠른 정답표는 보통 해설지 맨 앞 1~2쪽에 있으므로 앞쪽 몇 쪽만 잘라 보낸다(빠르고 싸다). 읽은 값은 바로 저장하지 않고
// 화면 표에 채워 원장님이 확인한 뒤 "정답표 저장"을 누른다(app/(staff)/exams/[code]/MockCsatPanel.tsx).

type Client = any;
const FIRST_PAGES = 4;

const ITEMS = {
  type: "array",
  items: {
    type: "object",
    properties: { no: { type: "integer" }, answer: { type: "string" } },
    required: ["no", "answer"],
  },
};

export const MOCK_ANSWER_TOOL = {
  name: "submit_answers",
  description: "해설지에 적힌 문항별 정답을 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      common: { ...ITEMS, description: "공통 과목 1~22번" },
      prob: { ...ITEMS, description: "선택과목 확률과 통계 23~30번(해설지에 없으면 빈 배열)" },
      calc: { ...ITEMS, description: "선택과목 미적분 23~30번(없으면 빈 배열)" },
      geom: { ...ITEMS, description: "선택과목 기하 23~30번(없으면 빈 배열)" },
    },
    required: ["common", "prob", "calc", "geom"],
  },
};

const PROMPT = [
  "첨부한 PDF는 한국 고3 수학 사설 모의고사(수능형)의 정답·해설지 앞부분입니다. 문항별 정답을 submit_answers 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요.",
  "",
  "규칙",
  "- 공통 과목(수학Ⅰ·수학Ⅱ)은 1~22번, 선택과목(확률과 통계 / 미적분 / 기하)은 각각 23~30번입니다.",
  "- 빠른 정답표가 있으면 그 값을 그대로 옮기세요. 없으면 해설 본문에 적힌 정답을 옮기세요. 직접 풀지 마세요.",
  "- 객관식(공통 1~15, 선택 23~28)은 1~5 숫자 하나(①이면 1). 단답형(공통 16~22, 선택 29~30)은 적힌 자연수 그대로.",
  "- 해설지에 없는 선택과목은 빈 배열로 두세요. 읽기 어렵거나 확실하지 않은 칸은 빼세요(추측하지 말 것).",
].join("\n");

async function firstPages(pdf: Buffer, n: number): Promise<Buffer> {
  try {
    const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
    const count = src.getPageCount();
    if (count <= n) return pdf;
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: n }, (_, i) => i));
    pages.forEach((p) => out.addPage(p));
    return Buffer.from(await out.save());
  } catch {
    return pdf;
  }
}

export async function readMockAnswersFromPdf(
  client: Client,
  pdf: Buffer
): Promise<{ ok: true; answers: CsatAnswers; found: number } | { ok: false; msg: string }> {
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 없습니다. AI 설정에서 먼저 저장해 주세요." };
  const part = await firstPages(pdf, FIRST_PAGES);
  const params = adaptParamsForModel({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: [MOCK_ANSWER_TOOL],
    tool_choice: { type: "tool", name: MOCK_ANSWER_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
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
  const use = (r.json.content as any[] | undefined)?.find((c) => c?.type === "tool_use" && c.name === MOCK_ANSWER_TOOL.name);
  const inp = use?.input ?? {};
  const answers = emptyAnswers();
  let found = 0;
  const put = (part: "공통" | "확통" | "미적" | "기하", arr: unknown, nos: number[]) => {
    for (const x of Array.isArray(arr) ? arr : []) {
      const no = Number((x as any)?.no);
      if (!nos.includes(no)) continue;
      const v = cleanAnswer(csatSpec(no, part).type, (x as any)?.answer);
      if (v) {
        answers[part][no] = v;
        found++;
      }
    }
  };
  put("공통", inp.common, COMMON_NOS);
  put("확통", inp.prob, CHOICE_NOS);
  put("미적", inp.calc, CHOICE_NOS);
  put("기하", inp.geom, CHOICE_NOS);
  if (!found) return { ok: false, msg: "해설지 앞쪽에서 정답을 찾지 못했습니다. 표에 직접 적어 주세요." };
  return { ok: true, answers, found };
}
