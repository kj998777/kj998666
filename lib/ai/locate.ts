import "server-only";
import { addUsage, aiCreditKind, aiErr, createBatch, failWhy, getBatch, getBatchResults, toolInputOf } from "./anthropic";
import { autoBbox, autoLabel } from "./normalize";
import { getExamPdfBuffer } from "./pdf";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { clearLowBalanceAlert, getAiCreds, recordLowBalanceAlert, recordUsage } from "./settings";

// 문항 영역(bbox) 다시 찾기 — 2026-09-28 원장님 제보·결정("AI로 좌표만 다시 찾기").
//
// 과외선생님 검토 화면(ProblemPageImage)은 item_explanations의 source_page + bbox_*가 있으면 그 문항 부분만
// 잘라 확대해 보여 준다. 그런데 bbox는 2026-09-27 저녁 이후 새로 AI 처리한 시험부터만 저장돼, 그 전에 처리된
// 시험은 쪽 전체가 보였다. 여기서는 좌표가 없는 "검토 대기" 문항들만 골라, 시험지 PDF와 함께 AI에게 "이 문항들이
// 몇 쪽 어디에 있는지"만 물어 좌표·쪽 번호를 채운다(정답·해설은 건드리지 않음).
//
// 진행 방식은 lib/ai/errorcheck.ts와 같다: 시험 하나당 요청 하나를 Message Batches로 보내고(서버리스 실행 시간
// 제한 때문), 크론(/api/ai/cron-tick)이나 검토현황 화면이 tickLocateJobs를 부를 때마다 결과를 확인한다.
// 상태는 item_locate_jobs(0024)에 시험당 한 줄. 이 테이블이 없으면(0024 전) 모든 함수가 조용히 아무것도 안 한다.

type Client = any;

export const LOCATE_TOOL = {
  name: "locate_items",
  description: "지정한 문항들이 시험지의 몇 쪽, 어느 영역에 인쇄돼 있는지 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "아래 목록의 문항 번호(label)를 그대로" },
            page: { type: "integer", description: "문항이 시작하는 쪽(PDF 1쪽부터 센 번호)" },
            bbox: {
              type: "object",
              description: "그 쪽을 가로세로 1000칸으로 나눈 좌표로 본 문항 전체 영역",
              properties: {
                x0: { type: "number" },
                y0: { type: "number" },
                x1: { type: "number" },
                y1: { type: "number" },
              },
              required: ["x0", "y0", "x1", "y1"],
            },
          },
          required: ["label", "page", "bbox"],
        },
      },
    },
    required: ["items"],
  },
};

type Target = { label: string; page: number | null; hint: string };

function locatePrompt(targets: Target[]): string {
  const list = targets
    .map((t) => `- label "${t.label}"` + (t.page ? ` (추정 쪽: ${t.page})` : "") + (t.hint ? ` — 문제 내용 요약: ${t.hint}` : ""))
    .join("\n");
  return [
    "첨부한 시험지 PDF에서 문항들이 각각 어디에 인쇄돼 있는지 찾아 locate_items 도구로 제출하세요.",
    "아래 목록의 문항은 반드시 포함하고, 그 밖에도 시험지에 있는 모든 문항(1번부터 마지막 번호, 서답형까지)의 자리를 함께 제출하세요 — 앞뒤 문항의 자리로 각 문항의 경계를 맞추는 데 씁니다.",
    "문항 번호(label)는 시험지에 인쇄된 번호입니다. 서답형은 \"서1\", \"서답형 1\" 같은 식으로 인쇄돼 있을 수 있습니다.",
    "요약은 AI가 만든 것이라 표현이 시험지와 다를 수 있으니, 번호를 기준으로 찾고 요약은 확인용으로만 쓰세요.",
    "",
    "page: 문항이 시작하는 쪽. PDF의 첫 쪽이 1입니다(시험지에 인쇄된 쪽 번호가 아니라 PDF에서 몇 번째 쪽인지).",
    "bbox: 이 문항 전체(문항 번호·문제 글·그림/그래프/표·<보기>·조건 상자·선택지 ①~⑤ 모두 포함, 다음 문항이나 앞 문항과는 안 겹치게)가 인쇄된 사각형 영역. 그 쪽을 가로 1000 × 세로 1000 칸으로 나눴을 때 왼쪽 위가 (0,0), 오른쪽 아래가 (1000,1000)이라고 보고: x0,y0 = 문항 영역의 왼쪽 위, x1,y1 = 오른쪽 아래. 과외선생님 화면에서 이 영역만 잘라서 확대해 보여 주는 데 쓰이므로, 문항의 모든 부분(특히 그림과 마지막 선택지)이 잘리지 않게 넉넉히 잡되 다른 문항 내용은 최대한 포함하지 마세요. 2단 편집이면 그 문항이 있는 단 안에서만 좌표를 잡으세요. 소문항(예 27-(1))은 원래 큰 문항 전체 영역을 씁니다.",
    "쪽 전체(0,0,1000,1000)를 답으로 내지 마세요 — 그 문항 부분만입니다.",
    "",
    "꼭 포함할 문항:",
    list,
  ].join("\n");
}

const TABLE = "item_locate_jobs";

export type Found = { label: string; page: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

/**
 * 2026-09-29: AI가 준 문항 영역을 앞뒤 문항 자리로 바로잡는다(각 문항의 영역을 따로 받으면 아래쪽이 잘리거나 다음 문항까지
 * 넘치는 일이 잦았다). 같은 쪽·같은 단의 문항을 위에서부터 줄 세운 뒤, 각 문항의 아래 끝을 "다음 문항 시작 바로 위"로 맞추고,
 * 가로는 그 단 전체 폭으로 넓힌다. 소문항(27-(1) 등)은 큰 문항 하나로 본다. 순수 함수(테스트용으로 내보냄).
 */
export function refineByNeighbors(found: Found[]): Map<string, Found> {
  const baseOf = (l: string) => l.replace(/-\(.*$/, "");
  const byBase = new Map<string, Found>();
  for (const f of found) {
    const b = baseOf(f.label);
    if (!byBase.has(b)) byBase.set(b, { ...f, bbox: { ...f.bbox } });
  }
  const list = Array.from(byBase.entries());
  const pages = new Map<number, [string, Found][]>();
  for (const e of list) {
    const arr = pages.get(e[1].page) ?? [];
    arr.push(e);
    pages.set(e[1].page, arr);
  }
  for (const arr of pages.values()) {
    // 대부분이 쪽 가로의 60% 넘게 차지하면 1단
    const wide = arr.filter(([, f]) => f.bbox.x1 - f.bbox.x0 > 600).length;
    const single = wide * 2 >= arr.length;
    const colOf = (f: Found) => (single ? 0 : (f.bbox.x0 + f.bbox.x1) / 2 < 500 ? 0 : 1);
    for (const c of [0, 1]) {
      const col = arr.filter(([, f]) => colOf(f) === c).sort((a, b) => a[1].bbox.y0 - b[1].bbox.y0);
      if (!col.length) continue;
      const cx0 = Math.min(...col.map(([, f]) => f.bbox.x0));
      const cx1 = Math.max(...col.map(([, f]) => f.bbox.x1));
      for (let i = 0; i < col.length; i++) {
        const f = col[i][1];
        f.bbox.x0 = cx0;
        f.bbox.x1 = cx1;
        const next = col[i + 1]?.[1];
        if (next && next.bbox.y0 - 4 > f.bbox.y0 + 15) f.bbox.y1 = next.bbox.y0 - 4;
      }
    }
  }
  const out = new Map<string, Found>();
  for (const f of found) {
    const r = byBase.get(baseOf(f.label));
    if (r) out.set(f.label, { label: f.label, page: r.page, bbox: { ...r.bbox } });
  }
  return out;
}

function kstTime(d = new Date()): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

async function setLocateJob(client: Client, examId: string, patch: Record<string, unknown>): Promise<void> {
  await (client.from(TABLE) as any).update({ ...patch, updated_at: new Date().toISOString() }).eq("exam_id", examId);
}

/** 이 시험에서 좌표를 찾아야 하는 문항: 과외선생님 검토 대기(미검토·미확정)이면서 좌표가 없는 문항 */
async function targetsOf(client: Client, examId: string): Promise<Target[]> {
  const { data, error } = (await client
    .from("item_explanations")
    .select("item_label, source_page, problem_statement, bbox_x0, tutor_reviewed, review_confirmed")
    .eq("exam_id", examId)) as any;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? [])
    .filter((r) => r.bbox_x0 == null && !r.tutor_reviewed && !r.review_confirmed)
    .map((r) => ({
      label: String(r.item_label),
      page: typeof r.source_page === "number" && r.source_page > 0 ? r.source_page : null,
      hint: String(r.problem_statement || "")
        .replace(/\s+/g, " ")
        .slice(0, 80),
    }));
}

/**
 * 검토 대기(미검토·미확정)이면서 좌표가 없는 문항의 exam_id 목록(문항 하나당 한 줄).
 * 2026-09-29: 전에는 문항 전체를 한 번에 읽어 앱에서 걸렀는데, Supabase는 한 번에 최대 1000줄만 돌려줘서
 * 검토 대기 문항이 많으면 일부 시험이 통째로 빠져 영역 찾기가 아예 안 걸릴 수 있었다. 조건을 DB에서 걸고
 * 1000줄씩 나눠 읽는다(시험 id도 100개씩 나눠 주소 길이 초과를 막음).
 */
async function missingItemExamIds(client: Client, examIds: string[]): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let i = 0; i < examIds.length; i += 100) {
    const chunk = examIds.slice(i, i + 100);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = (await client
        .from("item_explanations")
        .select("id, exam_id")
        .in("exam_id", chunk)
        .is("bbox_x0", null)
        .eq("tutor_reviewed", false)
        .eq("review_confirmed", false)
        .order("id")
        .range(from, from + PAGE - 1)) as any;
      if (error) throw new Error(error.message);
      const rows = (data as any[]) ?? [];
      for (const r of rows) out.push(r.exam_id);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** 검토 대기 시험들에서 좌표 없는 검토 문항 수(화면 표시용). */
export async function countMissingLocateItems(client: Client): Promise<number> {
  const { data: exams } = await fetchAllPages((f: number, t: number) =>
    client.from("exams").select("id").eq("status", "검수대기").order("id").range(f, t)
  );
  const ids: string[] = ((exams as any[]) ?? []).map((e) => e.id);
  if (!ids.length) return 0;
  try {
    return (await missingItemExamIds(client, ids)).length;
  } catch {
    return 0;
  }
}

/**
 * 검토 대기 시험 중 좌표 없는 문항이 있는 시험마다 작업을 만든다(이미 진행 중이거나 끝난 작업은 그대로,
 * 오류로 멈춘 작업은 다시 시작). 만든(다시 시작한) 시험 수를 돌려준다. 0024 전이면 0.
 */
export async function enqueueMissingLocateJobs(client: Client): Promise<{ queued: number; missingItems: number }> {
  const { data: exams } = await fetchAllPages((f: number, t: number) =>
    client.from("exams").select("id").eq("status", "검수대기").order("id").range(f, t)
  );
  const examIds: string[] = ((exams as any[]) ?? []).map((e) => e.id);
  if (!examIds.length) return { queued: 0, missingItems: 0 };

  const missingBy = new Map<string, number>();
  for (const id of await missingItemExamIds(client, examIds)) missingBy.set(id, (missingBy.get(id) ?? 0) + 1);
  const need = Array.from(missingBy.keys());
  const missingItems = Array.from(missingBy.values()).reduce((a, b) => a + b, 0);
  if (!need.length) return { queued: 0, missingItems: 0 };

  const { data: existing, error } = (await client.from(TABLE).select("exam_id, stage").in("exam_id", need)) as any;
  if (error) return { queued: 0, missingItems }; // 0024 전
  const stageOf = new Map(((existing as any[]) ?? []).map((j) => [j.exam_id, j.stage as string]));

  let queued = 0;
  for (const examId of need) {
    const st = stageOf.get(examId);
    if (st === "submit" || st === "wait") continue; // 진행 중
    // done인데 아직 좌표 없는 문항이 남았다면(AI가 일부를 못 찾음) 한 번 더 시도, error도 다시 시도
    const now = new Date().toISOString();
    // created_at = 이번 시도를 시작한 시각(AI 설정 화면의 "시작" 칸). 다시 시도하면 새로 찍는다.
    const row = { exam_id: examId, stage: "submit", batch_id: null, attempts: 0, message: "영역 찾기 대기 중", created_at: now, updated_at: now };
    const { error: upErr } = await (client.from(TABLE) as any).upsert(row, { onConflict: "exam_id" });
    if (!upErr) queued++;
  }
  return { queued, missingItems };
}

/** 새 시험 AI 처리 직후(lib/ai/pipeline.ts finishExam): 좌표 없는 검토 문항이 있으면 작업을 걸어 둔다. */
export async function enqueueLocateJobIfMissing(client: Client, examId: string): Promise<void> {
  try {
    const targets = await targetsOf(client, examId);
    if (!targets.length) return;
    await (client.from(TABLE) as any).upsert(
      { exam_id: examId, stage: "submit", batch_id: null, attempts: 0, message: "영역 찾기 대기 중", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "exam_id" }
    );
  } catch {
    /* 0024 전이거나 일시 오류 — 검토현황의 버튼으로 다시 걸 수 있음 */
  }
}

async function stepSubmit(client: Client, job: any): Promise<void> {
  const examId: string = job.exam_id;
  const targets = await targetsOf(client, examId);
  if (!targets.length) {
    await setLocateJob(client, examId, { stage: "done", message: "좌표를 찾을 문항이 없습니다." });
    return;
  }
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) {
    await setLocateJob(client, examId, { stage: "error", message: "AI API 키가 없습니다. AI 설정에서 먼저 저장해 주세요." });
    return;
  }
  const buf = await getExamPdfBuffer(client, examId);
  const doc = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
    cache_control: { type: "ephemeral" },
  };
  const r = await createBatch(apiKey, [
    {
      custom_id: "loc",
      params: {
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools: [LOCATE_TOOL],
        tool_choice: { type: "tool", name: LOCATE_TOOL.name },
        messages: [{ role: "user", content: [doc, { type: "text", text: locatePrompt(targets) }] }],
      },
    },
  ]);
  const kind = aiCreditKind(r);
  if (kind) {
    await recordLowBalanceAlert(client, kind, String(r.json?.error?.message || r.text || "").slice(0, 300));
    await setLocateJob(client, examId, {
      stage: "error",
      message: kind === "credit" ? "Anthropic 크레딧이 부족합니다. 충전 후 다시 시도해 주세요." : "Anthropic 사용 한도에 도달했습니다. 한도가 풀린 뒤 다시 시도해 주세요.",
    });
    return;
  }
  if (r.status !== 200 || !r.json?.id) {
    const attempts = (job.attempts ?? 0) + 1;
    await setLocateJob(client, examId, {
      stage: attempts >= 3 ? "error" : "submit",
      attempts,
      message: "AI 요청 실패: " + aiErr(r),
    });
    return;
  }
  await clearLowBalanceAlert(client);
  await setLocateJob(client, examId, {
    stage: "wait",
    batch_id: r.json.id,
    attempts: 0,
    message: `문항 ${targets.length}개의 영역을 찾는 중… (${kstTime()} AI에 보냄 · 결과 대기 — 보통 수 분, AI 쪽이 붐비면 1시간 가까이 걸릴 수 있음)`,
  });
}

async function stepWait(client: Client, job: any): Promise<void> {
  const examId: string = job.exam_id;
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) {
    await setLocateJob(client, examId, { stage: "error", message: "AI API 키가 없습니다." });
    return;
  }
  const b = await getBatch(apiKey, job.batch_id);
  if (b.processing_status !== "ended") {
    await setLocateJob(client, examId, {}); // updated_at만 갱신(다음 차례로)
    return;
  }
  const results = await getBatchResults(apiKey, b);
  const line = results["loc"];
  const delta = addUsage({ i: 0, o: 0 }, line);
  if (delta) await recordUsage(client, model, delta.di, delta.dO);

  const input = toolInputOf(line, LOCATE_TOOL.name);
  const found: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!found.length) {
    const attempts = (job.attempts ?? 0) + 1;
    await setLocateJob(client, examId, {
      stage: attempts >= 2 ? "error" : "submit",
      attempts,
      batch_id: null,
      message: "AI가 영역을 돌려주지 않았습니다: " + failWhy(line).slice(0, 150),
    });
    return;
  }

  const targets = await targetsOf(client, examId);
  const want = new Set(targets.map((t) => t.label));
  const norm = (s: unknown) => autoLabel(s); // "서답형 1"·"서1"·"3번" 같은 표기 차이를 맞춤
  // 받은 모든 문항 자리를 정리한 뒤(쪽 전체에 가까운 영역은 버림) 앞뒤 문항으로 경계를 맞춘다
  const clean: Found[] = [];
  for (const f of found) {
    const bbox = autoBbox(f?.bbox);
    const page = Number(f?.page);
    if (!bbox || !(page >= 1) || (bbox.x1 - bbox.x0 >= 950 && bbox.y1 - bbox.y0 >= 950)) continue;
    clean.push({ label: norm(f?.label), page: Math.round(page), bbox });
  }
  const refined = refineByNeighbors(clean);
  let saved = 0;
  for (const [label, r] of refined) {
    const match = want.has(label) ? label : targets.find((t) => norm(t.label) === label)?.label;
    // (want에는 DB 표기 그대로, label은 정리한 표기 — 둘 다 autoLabel 규칙이라 대부분 같다)
    if (!match) continue;
    const bbox = r.bbox;
    const page = r.page;
    const { error } = await (client.from("item_explanations") as any)
      .update({
        source_page: Math.round(page),
        bbox_x0: Math.round(bbox.x0),
        bbox_y0: Math.round(bbox.y0),
        bbox_x1: Math.round(bbox.x1),
        bbox_y1: Math.round(bbox.y1),
      })
      .eq("exam_id", examId)
      .eq("item_label", match)
      .is("bbox_x0", null);
    if (!error) {
      saved++;
      want.delete(match);
    }
  }
  const left = want.size;
  await setLocateJob(client, examId, {
    stage: "done",
    batch_id: null,
    attempts: 0,
    message:
      `문항 ${targets.length}개 중 ${saved}개의 영역을 찾아 저장했습니다.` +
      (left ? ` 못 찾은 ${left}개(${Array.from(want).slice(0, 8).join(", ")})는 쪽 전체로 보입니다.` : ""),
  });
}

/**
 * 다른 호출(크론·검토현황 화면의 주기 확인·버튼)과 같은 작업을 동시에 잡지 않도록, 읽어 온 그 상태 그대로일 때만
 * updated_at을 바꿔 "내가 잡았다"고 표시한다(낙관적 잠금). 성공하면 true.
 * 2026-09-29: 전에는 잠금이 없어, 크론과 화면 확인이 겹치면 한 시험을 두 번 AI에 보내(배치 중복·크레딧 낭비)
 * 뒤에 보낸 배치 번호가 앞의 것을 덮어쓰는 일이 생길 수 있었다.
 */
async function claimJob(client: Client, job: any): Promise<boolean> {
  if (!job.updated_at) return true;
  const { data, error } = (await (client.from(TABLE) as any)
    .update({ updated_at: new Date().toISOString() })
    .eq("exam_id", job.exam_id)
    .eq("stage", job.stage)
    .eq("updated_at", job.updated_at)
    .select("exam_id")) as any;
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

// 제출 한 번 = 시험지 PDF 내려받기 + AI에 PDF 통째로 올리기라 몇 초~십수 초가 걸린다. 남은 시간이 이보다 적으면
// 새 제출은 시작하지 않는다(서버 실행 시간 제한에 걸려 "AI엔 보냈는데 기록은 못 한" 상태를 만들지 않도록).
const SUBMIT_MIN_MS = 15_000;
const WAIT_MIN_MS = 4_000;
// 한 번에 동시에 진행할 작업 수. 2026-09-29 전에는 한 시험씩 차례로만 처리해서, 시험이 많으면 제출만 여러
// 주기에 걸쳐 조금씩 되는 바람에 전체가 한참 늦어졌다.
const CONCURRENCY = 4;

/**
 * 진행 중인 영역 찾기 작업을 한 걸음씩 진행한다(오래 기다린 것부터, 최대 CONCURRENCY개씩 동시에).
 * deadline(Date.now() 기준 ms) 안에서만 새 작업을 시작한다. 처리한 작업 수를 돌려준다. 0024 전이면 0.
 */
export async function tickLocateJobs(client: Client, deadline: number): Promise<number> {
  const { data: jobs, error } = (await client
    .from(TABLE)
    .select("exam_id, stage, batch_id, attempts, updated_at")
    .in("stage", ["submit", "wait"])
    .order("updated_at", { ascending: true })
    .limit(40)) as any;
  if (error) return 0;
  const queue: any[] = [...((jobs as any[]) ?? [])];
  let n = 0;

  async function runOne(job: any): Promise<void> {
    if (!(await claimJob(client, job))) return; // 다른 호출이 이미 잡음
    try {
      if (job.stage === "submit") await stepSubmit(client, job);
      else if (job.stage === "wait" && job.batch_id) await stepWait(client, job);
      else await setLocateJob(client, job.exam_id, { stage: "submit", batch_id: null });
      n++;
    } catch (e: any) {
      const attempts = (job.attempts ?? 0) + 1;
      await setLocateJob(client, job.exam_id, {
        stage: attempts >= 5 ? "error" : job.stage,
        attempts,
        message: "일시 오류(다시 시도함): " + String(e?.message || e).slice(0, 200),
      }).catch(() => {});
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const left = deadline - Date.now();
      // 남은 시간에 맞는 작업을 앞에서부터 고른다(시간이 모자라면 제출은 건너뛰고 결과 확인만).
      const i = queue.findIndex((j) => left >= (j.stage === "submit" ? SUBMIT_MIN_MS : WAIT_MIN_MS));
      if (i < 0) return;
      const [job] = queue.splice(i, 1);
      await runOne(job);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return n;
}

export type LocateSummary = {
  available: boolean; // 0024 적용 여부
  missingItems: number; // 검토 대기 중 좌표 없는 문항 수
  jobs: { examId: string; stage: string; message: string; updatedAt: string }[];
};

/** 검토현황 화면용 요약 */
export async function getLocateSummary(client: Client, examIds: string[]): Promise<LocateSummary> {
  const { data: jobs, error } = (await client
    .from(TABLE)
    .select("exam_id, stage, message, updated_at")
    .order("updated_at", { ascending: false })) as any;
  if (error) return { available: false, missingItems: 0, jobs: [] };
  let missingItems = 0;
  if (examIds.length) {
    missingItems = (await missingItemExamIds(client, examIds).catch(() => [])).length;
  }
  return {
    available: true,
    missingItems,
    jobs: ((jobs as any[]) ?? []).map((j) => ({ examId: j.exam_id, stage: j.stage, message: j.message, updatedAt: j.updated_at })),
  };
}

// ---------------------------------------------------------------------------
// 2026-09-29: "디지털 시험지를 원본으로 적용"한 시험의 옛 좌표 바로잡기
//
// 이 날 전에는 원본으로 적용해도 문항 좌표가 스캔본 기준으로 남아 있어, 과외선생님 화면에 엉뚱한 곳·다른 번호 문제가
// 잘려 나왔다(lib/ai/relocate.ts 참고). 이제는 적용할 때 새 PDF에서 잰 자리를 저장하지만, 그 전에 적용한 시험은
// 옛 좌표가 그대로다. 그런 시험(적용 시각이 CUTOFF 전 — 예전에는 다시 올려도 uploaded_at이 처음 시각에 멈춰 있었으므로
// 모두 해당)의 검토 대기 문항 좌표를 지우고, 새 PDF에서 AI로 다시 찾게 한다.
// ---------------------------------------------------------------------------
const DIGITIZED_FIX_CUTOFF = "2026-09-29T01:00:00Z"; // 이 수정이 배포되는 시각(한국 29일 오전 10시) 무렵

async function staleDigitizedExamIds(client: Client): Promise<string[]> {
  const { data: metas, error } = await fetchAllPages((f: number, t: number) =>
    client
      .from("exam_pdf_meta")
      .select("exam_id, uploaded_at")
      .eq("replaced_with_digitized", true)
      .lt("uploaded_at", DIGITIZED_FIX_CUTOFF)
      .order("exam_id")
      .range(f, t)
  );
  if (error) return [];
  const ids = ((metas as any[]) ?? []).map((m) => m.exam_id);
  if (!ids.length) return [];
  const pending = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = (await client.from("exams").select("id").in("id", ids.slice(i, i + 150)).eq("status", "검수대기")) as any;
    for (const e of (data as any[]) ?? []) pending.add(e.id);
  }
  return ids.filter((id: string) => pending.has(id));
}

/** 바로잡을 대상: 옛 좌표가 남은 검수대기 시험 수와 그 안의 좌표 있는 검토 대기 문항 수 */
export async function countStaleDigitized(client: Client): Promise<{ exams: number; items: number }> {
  const ids = await staleDigitizedExamIds(client);
  let items = 0;
  const withItems: string[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = (await client
      .from("item_explanations")
      .select("exam_id")
      .in("exam_id", ids.slice(i, i + 150))
      .eq("tutor_reviewed", false)
      .eq("review_confirmed", false)
      .not("source_page", "is", null)) as any;
    for (const r of (data as any[]) ?? []) {
      items++;
      withItems.push(r.exam_id);
    }
  }
  return { exams: new Set(withItems).size, items };
}

/** 옛 좌표를 지우고 AI 영역 찾기를 다시 건다. 처리한 시험·문항 수를 돌려준다. */
export async function resetStaleDigitized(client: Client): Promise<{ exams: number; items: number }> {
  const ids = await staleDigitizedExamIds(client);
  let exams = 0;
  let items = 0;
  for (const examId of ids) {
    const { data, error } = (await (client.from("item_explanations") as any)
      .update({ source_page: null, bbox_x0: null, bbox_y0: null, bbox_x1: null, bbox_y1: null })
      .eq("exam_id", examId)
      .eq("tutor_reviewed", false)
      .eq("review_confirmed", false)
      .not("source_page", "is", null)
      .select("id")) as any;
    if (error) continue;
    const n = ((data as any[]) ?? []).length;
    if (!n) continue;
    exams++;
    items += n;
    await enqueueLocateJobIfMissing(client, examId);
  }
  return { exams, items };
}

// ---------------------------------------------------------------------------
// 2026-09-29 원장님 요청: 영역 찾기가 "완료"된 문항도 위치를 전부 다시 점검
//
// 글자 정보가 있는 PDF(is_scanned=false, 디지털 적용 아님)는 과외선생님 화면이 PDF 글자 위치에서 문항 번호를 직접 찾아
// 자르므로(cropLocator.ts) 저장된 AI 좌표에 기대지 않는다 → 대상에서 뺀다. 스캔본·디지털 조판본(그림 PDF)·판단 불가 PDF의
// 검수대기 시험만, 검토 대기 문항의 좌표를 지우고 앞뒤 문항 경계 맞추기(refineByNeighbors)가 들어간 새 영역 찾기를 다시 건다.
// ---------------------------------------------------------------------------
async function recheckExamIds(client: Client): Promise<string[]> {
  const [{ data: metas, error }, { data: pending }] = await Promise.all([
    fetchAllPages((f: number, t: number) =>
      client.from("exam_pdf_meta").select("exam_id, is_scanned, replaced_with_digitized").order("exam_id").range(f, t)
    ),
    fetchAllPages((f: number, t: number) =>
      client.from("exams").select("id").eq("status", "검수대기").order("id").range(f, t)
    ),
  ]);
  if (error) return [];
  const pend = new Set(((pending as any[]) ?? []).map((e) => e.id));
  return ((metas as any[]) ?? [])
    .filter((m) => pend.has(m.exam_id) && (m.is_scanned !== false || m.replaced_with_digitized === true))
    .map((m) => m.exam_id);
}

/** 다시 점검할 대상: 시험 수와 그 안의 위치가 저장된 검토 대기 문항 수 */
export async function countRecheck(client: Client): Promise<{ exams: number; items: number }> {
  const ids = await recheckExamIds(client);
  let items = 0;
  const hit = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await fetchAllPages((f: number, t: number) =>
      client
        .from("item_explanations")
        .select("id, exam_id")
        .in("exam_id", ids.slice(i, i + 150))
        .eq("tutor_reviewed", false)
        .eq("review_confirmed", false)
        .not("source_page", "is", null)
        .order("id")
        .range(f, t)
    );
    for (const r of (data as any[]) ?? []) {
      items++;
      hit.add(r.exam_id);
    }
  }
  return { exams: hit.size, items };
}

/** 위치를 지우고 새 영역 찾기를 건다. 처리한 시험·문항 수를 돌려준다. */
export async function resetForRecheck(client: Client): Promise<{ exams: number; items: number }> {
  const ids = await recheckExamIds(client);
  let exams = 0;
  let items = 0;
  for (const examId of ids) {
    const { data, error } = (await (client.from("item_explanations") as any)
      .update({ source_page: null, bbox_x0: null, bbox_y0: null, bbox_x1: null, bbox_y1: null })
      .eq("exam_id", examId)
      .eq("tutor_reviewed", false)
      .eq("review_confirmed", false)
      .not("source_page", "is", null)
      .select("id")) as any;
    if (error) continue;
    const n = ((data as any[]) ?? []).length;
    if (!n) continue;
    exams++;
    items += n;
    await enqueueLocateJobIfMissing(client, examId);
  }
  return { exams, items };
}
