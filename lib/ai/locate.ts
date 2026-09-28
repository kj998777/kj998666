import "server-only";
import { addUsage, aiCreditKind, aiErr, createBatch, failWhy, getBatch, getBatchResults, toolInputOf } from "./anthropic";
import { autoBbox } from "./normalize";
import { getExamPdfBuffer } from "./pdf";
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
    "첨부한 시험지 PDF에서 아래 문항들이 각각 어디에 인쇄돼 있는지 찾아 locate_items 도구로 제출하세요.",
    "문항 번호(label)는 시험지에 인쇄된 번호입니다. 서답형은 \"서1\", \"서답형 1\" 같은 식으로 인쇄돼 있을 수 있습니다.",
    "요약은 AI가 만든 것이라 표현이 시험지와 다를 수 있으니, 번호를 기준으로 찾고 요약은 확인용으로만 쓰세요.",
    "",
    "page: 문항이 시작하는 쪽. PDF의 첫 쪽이 1입니다(시험지에 인쇄된 쪽 번호가 아니라 PDF에서 몇 번째 쪽인지).",
    "bbox: 이 문항 전체(문항 번호·문제 글·그림/그래프/표·<보기>·조건 상자·선택지 ①~⑤ 모두 포함, 다음 문항이나 앞 문항과는 안 겹치게)가 인쇄된 사각형 영역. 그 쪽을 가로 1000 × 세로 1000 칸으로 나눴을 때 왼쪽 위가 (0,0), 오른쪽 아래가 (1000,1000)이라고 보고: x0,y0 = 문항 영역의 왼쪽 위, x1,y1 = 오른쪽 아래. 과외선생님 화면에서 이 영역만 잘라서 확대해 보여 주는 데 쓰이므로, 문항의 모든 부분(특히 그림과 마지막 선택지)이 잘리지 않게 넉넉히 잡되 다른 문항 내용은 최대한 포함하지 마세요. 2단 편집이면 그 문항이 있는 단 안에서만 좌표를 잡으세요. 소문항(예 27-(1))은 원래 큰 문항 전체 영역을 씁니다.",
    "쪽 전체(0,0,1000,1000)를 답으로 내지 마세요 — 그 문항 부분만입니다.",
    "",
    "찾을 문항:",
    list,
  ].join("\n");
}

const TABLE = "item_locate_jobs";

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
 * 검토 대기 시험 중 좌표 없는 문항이 있는 시험마다 작업을 만든다(이미 진행 중이거나 끝난 작업은 그대로,
 * 오류로 멈춘 작업은 다시 시작). 만든(다시 시작한) 시험 수를 돌려준다. 0024 전이면 0.
 */
export async function enqueueMissingLocateJobs(client: Client): Promise<{ queued: number; missingItems: number }> {
  const { data: exams } = (await client.from("exams").select("id").eq("status", "검수대기")) as any;
  const examIds: string[] = ((exams as any[]) ?? []).map((e) => e.id);
  if (!examIds.length) return { queued: 0, missingItems: 0 };

  const { data: items } = (await client
    .from("item_explanations")
    .select("exam_id, bbox_x0, tutor_reviewed, review_confirmed")
    .in("exam_id", examIds)) as any;
  const missingBy = new Map<string, number>();
  for (const r of (items as any[]) ?? []) {
    if (r.bbox_x0 == null && !r.tutor_reviewed && !r.review_confirmed) missingBy.set(r.exam_id, (missingBy.get(r.exam_id) ?? 0) + 1);
  }
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
    const row = { exam_id: examId, stage: "submit", batch_id: null, message: "영역 찾기 대기 중", updated_at: new Date().toISOString() };
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
      { exam_id: examId, stage: "submit", batch_id: null, message: "영역 찾기 대기 중", updated_at: new Date().toISOString() },
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
    message: `문항 ${targets.length}개의 영역을 찾는 중… (AI 처리 대기, 보통 몇 분)`,
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
  const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "");
  let saved = 0;
  for (const f of found) {
    const label = String(f?.label ?? "");
    const match = want.has(label) ? label : targets.find((t) => norm(t.label) === norm(label))?.label;
    if (!match) continue;
    const bbox = autoBbox(f?.bbox);
    const page = Number(f?.page);
    // 쪽 전체에 가까운 영역(가로·세로 모두 95% 이상)은 잘라 보여 주는 의미가 없으므로 저장하지 않는다.
    if (!bbox || !(page >= 1) || (bbox.x1 - bbox.x0 >= 950 && bbox.y1 - bbox.y0 >= 950)) continue;
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
 * 진행 중인 영역 찾기 작업을 한 걸음씩 진행한다(오래 기다린 것부터). deadline(Date.now() 기준 ms)이 지나면
 * 멈춘다. 처리한 작업 수를 돌려준다. 0024 전이면 0.
 */
export async function tickLocateJobs(client: Client, deadline: number): Promise<number> {
  const { data: jobs, error } = (await client
    .from(TABLE)
    .select("exam_id, stage, batch_id, attempts, updated_at")
    .in("stage", ["submit", "wait"])
    .order("updated_at", { ascending: true })
    .limit(20)) as any;
  if (error) return 0;
  let n = 0;
  for (const job of (jobs as any[]) ?? []) {
    if (Date.now() > deadline) break;
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
    const { data: items } = (await client
      .from("item_explanations")
      .select("exam_id, bbox_x0, tutor_reviewed, review_confirmed")
      .in("exam_id", examIds)) as any;
    missingItems = ((items as any[]) ?? []).filter((r) => r.bbox_x0 == null && !r.tutor_reviewed && !r.review_confirmed).length;
  }
  return {
    available: true,
    missingItems,
    jobs: ((jobs as any[]) ?? []).map((j) => ({ examId: j.exam_id, stage: j.stage, message: j.message, updatedAt: j.updated_at })),
  };
}
