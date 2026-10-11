import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { adaptParamsForModel, aiCreditKind, aiErr, anthropicCall } from "./anthropic";
import { getAiCreds, recordUsage } from "./settings";
import {
  CHOICE_NOS,
  COMMON_NOS,
  cleanAnswer,
  cleanGradeCuts,
  csatSpec,
  emptyAnswers,
  isChoiceKey,
  type CsatAnswers,
  type GradeCuts,
  type PageEntry,
} from "@/lib/exams/mockCsat";

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
      // 0055: 해설지에 전국 예상 등급컷이 실려 있으면 함께
      grade_cuts: {
        type: "array",
        description: "해설지에 '예상 등급컷'(원점수)이 실려 있으면 선택과목별로. 없으면 빈 배열",
        items: {
          type: "object",
          properties: {
            subject: { type: "string", enum: ["확통", "미적", "기하"] },
            cuts: { type: "array", items: { type: "number" }, description: "1등급컷, 2등급컷, … 순서의 원점수" },
          },
          required: ["subject", "cuts"],
        },
      },
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
  "- '예상 등급컷'(전국 1컷·2컷·3컷 원점수) 표가 있으면 grade_cuts에 선택과목별로 옮기세요. 없으면 빈 배열.",
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
): Promise<{ ok: true; answers: CsatAnswers; found: number; gradeCuts: GradeCuts } | { ok: false; msg: string }> {
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
  const raw: Record<string, unknown> = {};
  for (const g of Array.isArray(inp.grade_cuts) ? inp.grade_cuts : []) if (isChoiceKey(g?.subject)) raw[g.subject] = g.cuts;
  return { ok: true, answers, found, gradeCuts: cleanGradeCuts(raw) };
}

// ---------------------------------------------------------------------
// 해설지에서 문항별 풀이 쪽 찾기(0054 exams.solution_page_map) — 2026-10-11 원장님 "보고서 만들 때 올린 해설에서 틀린 문제 해설을
// 찾아서 첨부해 줘". 스캔 해설지라 글자가 없으므로 AI가 쪽 그림을 본다. 한 번에 다 보내면 60초 안에 끝나지 않을 수 있어
// SOLUTION_PAGE_BATCH쪽씩 나눠 보내고(화면이 여러 번 부름), 각 쪽 위에 "PDF p.N"을 찍어 AI가 쪽 번호를 헷갈리지 않게 한다.
// 묶음 결과는 lib/exams/mockCsat.ts buildPageMap이 하나로 모은다(과목 머리말이 없는 쪽은 순서로 메움).

const PAGE_TOOL = {
  name: "submit_pages",
  description: "각 쪽에 풀이(해설)가 실린 문항을 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page: { type: "integer", description: "쪽 위에 찍힌 PDF p.N 의 N" },
            items: {
              type: "array",
              description: "이 쪽에 풀이가 (일부라도) 실린 문항, 읽는 순서대로(왼쪽 단 위→아래, 그다음 오른쪽 단)",
              items: {
                type: "object",
                properties: {
                  no: { type: "integer", description: "문항 번호 1~30" },
                  part: { type: "string", enum: ["공통", "확통", "미적", "기하", "모름"], description: "1~22는 공통. 23~30은 이 쪽에 과목 이름(확률과 통계/미적분/기하)이 보이면 그 과목, 안 보이면 모름" },
                },
                required: ["no", "part"],
              },
            },
          },
          required: ["page", "items"],
        },
      },
    },
    required: ["pages"],
  },
};

const PAGE_PROMPT = [
  "첨부한 PDF는 한국 고3 수학 모의고사 해설지의 일부입니다. 각 쪽 왼쪽 위에 'PDF p.N'이 찍혀 있습니다.",
  "쪽마다 풀이(해설)가 실린 문항 번호를 submit_pages 도구로 제출하세요. 글로 답하지 말고 도구만 호출하세요.",
  "",
  "규칙",
  "- 문항 풀이가 앞 쪽에서 이어져 이 쪽 위에 조금만 있어도 그 문항을 넣으세요.",
  "- 빠른 정답표·정답 일람표, 표지, 차례, 총평·코멘트·등급컷처럼 문항 풀이가 아닌 부분은 넣지 마세요(그런 쪽은 items를 빈 배열로).",
  "- 공통 과목은 1~22번, 선택과목(확률과 통계/미적분/기하)은 23~30번입니다. 23~30번은 그 쪽에 과목 이름이 보일 때만 part를 정하고, 아니면 '모름'.",
  "- 찍힌 모든 쪽을 빠짐없이 pages에 넣으세요.",
].join("\n");

async function stampedRange(pdf: Buffer, from: number, to: number): Promise<{ bytes: Buffer; pageCount: number; from: number; to: number }> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const a = Math.max(1, Math.min(from, pageCount));
  const b = Math.max(a, Math.min(to, pageCount));
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const pages = await out.copyPages(src, Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  pages.forEach((p, i) => {
    out.addPage(p);
    const { height } = p.getSize();
    const label = `PDF p.${a + i}`;
    const size = 16;
    const w = font.widthOfTextAtSize(label, size);
    p.drawRectangle({ x: 6, y: height - 30, width: w + 12, height: 24, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0, 0), borderWidth: 1.5 });
    p.drawText(label, { x: 12, y: height - 24, size, font, color: rgb(0.85, 0, 0) });
  });
  return { bytes: Buffer.from(await out.save()), pageCount, from: a, to: b };
}

export async function locateSolutionPagesFromPdf(
  client: Client,
  pdf: Buffer,
  from: number,
  to: number
): Promise<{ ok: true; pageCount: number; pages: { page: number; items: PageEntry[] }[] } | { ok: false; msg: string }> {
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 없습니다. AI 설정에서 먼저 저장해 주세요." };
  let part: Awaited<ReturnType<typeof stampedRange>>;
  try {
    part = await stampedRange(pdf, from, to);
  } catch {
    return { ok: false, msg: "해설지 PDF를 열지 못했습니다." };
  }
  const params = adaptParamsForModel({
    model,
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    tools: [PAGE_TOOL],
    tool_choice: { type: "tool", name: PAGE_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.bytes.toString("base64") } },
          { type: "text", text: PAGE_PROMPT },
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
  const use = (r.json.content as any[] | undefined)?.find((c) => c?.type === "tool_use" && c.name === PAGE_TOOL.name);
  const pages: { page: number; items: PageEntry[] }[] = [];
  for (const p of Array.isArray(use?.input?.pages) ? use.input.pages : []) {
    const page = Number(p?.page);
    if (!Number.isInteger(page) || page < part.from || page > part.to) continue; // 이 묶음 밖 쪽 번호는 믿지 않음
    const items: PageEntry[] = [];
    for (const x of Array.isArray(p?.items) ? p.items : []) {
      const no = Number(x?.no);
      if (!Number.isInteger(no) || no < 1 || no > 30) continue;
      const pt = String(x?.part ?? "");
      items.push({ no, part: no <= 22 ? "공통" : isChoiceKey(pt) ? pt : null });
    }
    pages.push({ page, items });
  }
  return { ok: true, pageCount: part.pageCount, pages };
}
