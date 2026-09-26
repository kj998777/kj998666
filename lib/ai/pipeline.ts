import "server-only";
import type { ExamJobStage } from "@/lib/supabase/types";
import {
  AiCallResult,
  BatchRequest,
  addUsage,
  aiCreditKind,
  aiErr,
  cancelBatch,
  createBatch,
  deleteFile,
  failWhy,
  getBatch,
  getBatchResults,
  toolInputOf,
  uploadPdfFile,
} from "./anthropic";
import { EXTRACT_PROMPT, EXTRACT_TOOL, QuestionMeta, SOLVE_TOOL, solvePrompt } from "./prompts";
import { autoBaseCount, autoNormQs, autoStrList, autoTotalOf } from "./normalize";
import { AiSolution, CombinedFlag, autoCombine } from "./combine";
import { assignPoints } from "./points";
import { Job, JobState, getJob, isActiveStage, setJob } from "./job";
import { getExamPdfBuffer } from "./pdf";
import { clearLowBalanceAlert, getAiCreds, recordLowBalanceAlert, recordUsage } from "./settings";

// Client 타입을 any로 두는 이유는 lib/ai/settings.ts 상단 주석 참고(createServerClient와
// supabase-js의 SupabaseClient 타입이 대입되지 않는 실제 빌드 실패를 겪었음).
type Client = any;

export class PipelineError extends Error {
  fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.fatal = fatal;
  }
}

function throwErr(msg: string, fatal = false): never {
  throw new PipelineError(msg, fatal);
}

async function checkCredit(client: Client, r: AiCallResult): Promise<void> {
  const kind = aiCreditKind(r);
  if (!kind) return;
  const msg =
    kind === "credit"
      ? "Anthropic 크레딧이 부족해 요청이 거절됐습니다. AI 설정의 결제 페이지 버튼으로 크레딧을 충전한 뒤, 이 시험의 AI 처리를 다시 시작해 주세요."
      : "Anthropic API 사용 한도에 도달해 요청이 거절됐습니다. 결제 페이지에서 사용 한도를 올리거나 한도가 풀린 뒤 이 시험의 AI 처리를 다시 시작해 주세요.";
  await recordLowBalanceAlert(client, kind, String(r.json?.error?.message || r.text || "").slice(0, 300));
  throwErr(msg, true);
}

function buildParams(
  state: JobState,
  doc: unknown,
  tool: unknown,
  prompt: string,
  effort: "medium" | "high",
  maxTokens: number,
  forceTool: boolean
): Record<string, unknown> {
  return {
    model: state.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort },
    tools: [tool],
    tool_choice: forceTool ? { type: "tool", name: (tool as any).name } : { type: "auto" },
    messages: [{ role: "user", content: [doc, { type: "text", text: prompt }] }],
  };
}

function fileDoc(fileId: string) {
  return { type: "document", source: { type: "file", file_id: fileId }, cache_control: { type: "ephemeral" } };
}
function inlineDoc(base64: string) {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
    cache_control: { type: "ephemeral" },
  };
}
/** 배치를 만든다. 파일 참조가 거절되면(inline 폴백) PDF를 요청마다 직접 실어 여러 배치로 나눠 보낸다. */
async function createBatchesChunked(
  client: Client,
  examId: string,
  state: JobState,
  n: number,
  reqFn: (i: number, doc: unknown) => BatchRequest
): Promise<string[]> {
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throwErr("AI API 키가 아직 저장되지 않았습니다. AI 설정에서 키를 먼저 저장해 주세요.", true);

  async function make(from: number, to: number, doc: unknown) {
    const reqs: BatchRequest[] = [];
    for (let i = from; i < to; i++) reqs.push(reqFn(i, doc));
    return createBatch(apiKey!, reqs);
  }

  if (state.mode !== "inline") {
    const r = await make(0, n, fileDoc(state.fileId));
    await checkCredit(client, r);
    if (r.status === 401 || r.status === 403) throwErr("API 키 인증 실패: " + aiErr(r), true);
    if (r.status === 200 && r.json?.id) {
      await clearLowBalanceAlert(client);
      return [r.json.id];
    }
    const em = String(r.json?.error?.message || r.text || "");
    if (r.status === 400 && /file/i.test(em)) {
      state.mode = "inline";
    } else {
      throwErr("배치 요청 실패: " + aiErr(r));
    }
  }

  const buf = await getExamPdfBuffer(client, examId);
  const b64 = buf.toString("base64");
  const doc = inlineDoc(b64);
  const per = Math.max(1, Math.floor(30_000_000 / (b64.length + 4000)));
  const ids: string[] = [];
  for (let s = 0; s < n; s += per) {
    const r = await make(s, Math.min(n, s + per), doc);
    await checkCredit(client, r);
    if (r.status === 401 || r.status === 403) throwErr("API 키 인증 실패: " + aiErr(r), true);
    if (r.status !== 200 || !r.json?.id) throwErr("배치 요청 실패: " + aiErr(r));
    ids.push(r.json.id);
  }
  await clearLowBalanceAlert(client);
  return ids;
}

async function trackUsage(client: Client, state: JobState, line: any): Promise<void> {
  state.usage = state.usage || { i: 0, o: 0 };
  const delta = addUsage(state.usage, line);
  if (delta) await recordUsage(client, state.model, delta.di, delta.dO);
}

// ---------------------------------------------------------------------
// 시작 / 취소
// ---------------------------------------------------------------------

export async function startExamAiJob(
  client: Client,
  examId: string
): Promise<{ ok: true } | { ok: false; msg: string }> {
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 아직 저장되지 않았습니다. AI 설정에서 키를 먼저 저장해 주세요." };

  const existing = await getJob(client, examId);
  if (existing && isActiveStage(existing.stage)) return { ok: false, msg: "이미 처리 중입니다." };

  const { count } = await client
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  const { count: keyCount } = await client
    .from("answer_key")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  if ((count || 0) > 0 && (keyCount || 0) > 0) {
    return { ok: false, msg: `이미 학생 제출(${count}명)이 있는 시험입니다. 정답을 자동으로 덮어쓰면 채점이 어긋날 수 있어 막아 두었습니다.` };
  }

  const state: JobState = { model, started: new Date().toISOString(), usage: { i: 0, o: 0 }, err: 0 };
  await setJob(client, examId, "upload", "시험지를 AI에 올리는 중…", state);
  return { ok: true };
}

export async function cancelExamAiJob(client: Client, examId: string): Promise<{ ok: true } | { ok: false; msg: string }> {
  const job = await getJob(client, examId);
  if (!job || !isActiveStage(job.stage)) return { ok: false, msg: "진행 중인 작업이 없습니다." };
  const { apiKey } = await getAiCreds(client);
  const state = job.state;
  const ids: string[] = [];
  if (state.exBatch) ids.push(state.exBatch);
  for (const b of state.slBatches || []) ids.push(b);
  if (apiKey) for (const id of ids) await cancelBatch(apiKey, id);
  await setJob(client, examId, "error", "선생님이 처리를 취소했습니다.", state);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 단계별 진행 (tick 이 현재 단계에 맞는 함수를 한 번 호출)
// ---------------------------------------------------------------------

async function stepUpload(client: Client, examId: string, state: JobState): Promise<void> {
  const buf = await getExamPdfBuffer(client, examId);
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throwErr("AI API 키가 아직 저장되지 않았습니다.", true);
  const r = await uploadPdfFile(apiKey, buf);
  if (r.status === 401 || r.status === 403) throwErr("API 키 인증 실패: " + aiErr(r), true);
  state.err = 0;
  let how = "file";
  if (r.status < 400 && r.json?.id) {
    state.fileId = r.json.id;
  } else if (r.status === 429 || r.status >= 500) {
    throwErr("시험지 업로드 실패: " + aiErr(r));
  } else {
    state.mode = "inline";
    how = "inline";
  }
  await setJob(
    client,
    examId,
    "extract_submit",
    how === "file" ? "문항 목록을 읽는 중… (AI에 요청)" : "문항 목록을 읽는 중… (파일 업로드 대신 직접 첨부 방식)",
    state
  );
}

async function stepExtractSubmit(client: Client, examId: string, state: JobState): Promise<void> {
  const ids = await createBatchesChunked(client, examId, state, 1, (_i, doc) => ({
    custom_id: "extract",
    params: buildParams(
      state,
      doc,
      EXTRACT_TOOL,
      EXTRACT_PROMPT + (state.exHint || ""),
      state.exHint ? "high" : "medium",
      16000,
      state.tc !== "auto"
    ),
  }));
  state.exBatch = ids[0];
  state.err = 0;
  await setJob(client, examId, "extract_wait", "문항 목록을 읽는 중… (AI 처리 대기)", state);
}

async function stepExtractWait(client: Client, examId: string, state: JobState): Promise<void> {
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throwErr("AI API 키가 없습니다.", true);
  const b = await getBatch(apiKey, state.exBatch);
  if (b.processing_status !== "ended") {
    await setJob(client, examId, "extract_wait", "문항 목록을 읽는 중… (AI 처리 대기)", state);
    return;
  }
  const results = await getBatchResults(apiKey, b);
  const line = results["extract"];
  await trackUsage(client, state, line);
  const input = toolInputOf(line, "register_exam");
  const info = { renamed: [] as string[], dropped: [] as string[] };
  let qs: QuestionMeta[] = input ? autoNormQs(input, info) : [];
  let meta = input
    ? { areas: autoStrList(input.areas, 8, 40), notes: autoStrList(input.notes, 10, 300), title: String(input.exam_title || "").slice(0, 100) }
    : { areas: [] as string[], notes: [] as string[], title: "" };
  let tc = autoTotalOf(input);
  const prev = state.exPrev;
  delete state.exPrev;
  delete state.exHint;
  if (prev && (!qs.length || autoBaseCount(qs) < autoBaseCount(prev.qs))) {
    qs = prev.qs;
    meta = prev.meta;
    tc = prev.tc;
  }
  if (!qs.length) {
    if (!state.exRetry) {
      state.exRetry = 1;
      state.tc = "auto";
      await setJob(client, examId, "extract_submit", "문항 목록 읽기를 다시 시도합니다… (" + failWhy(line).slice(0, 120) + ")", state);
      return;
    }
    throwErr("문항 목록을 읽지 못했습니다: " + failWhy(line), true);
  }
  const baseN = autoBaseCount(qs);
  if (!prev && !state.exRetry && tc > 0 && baseN < tc) {
    state.exRetry = 1;
    state.tc = "auto";
    state.exPrev = { qs, meta, tc };
    state.exHint =
      "\n\n[다시 확인] 앞선 시도에서는 큰 문항을 " +
      baseN +
      "개만 등록했는데 시험지에는 " +
      tc +
      "개가 있다고 세었습니다. 빠진 문항이 있는지, 특히 서답형·서술형·단답형(따로 매겨진 번호, \"서1\" 같은 표시, 마지막 쪽·별도 쪽, 소문항 (1)(2))을 처음부터 다시 훑어 전부 등록하세요. 앞선 목록의 label: " +
      qs.map((q) => q.label).join(", ");
    await setJob(client, examId, "extract_submit", `찾은 문항(${baseN}개)이 시험지에서 센 문항 수(${tc}개)보다 적어 다시 확인합니다…`, state);
    return;
  }
  const warn: string[] = [];
  if (info.renamed.length) warn.push("서답형 번호가 객관식 번호와 겹쳐 이름을 바꿨습니다: " + info.renamed.slice(0, 10).join(", ") + ". 시험지의 서답형 번호와 맞는지 확인하세요.");
  if (info.dropped.length) warn.push(`같은 번호가 또 나와 뺀 문항이 ${info.dropped.length}개 있습니다(${info.dropped.slice(0, 8).join(", ")}). 빠진 문항이 없는지 시험지와 대조하세요.`);
  if (tc > 0 && baseN < tc) warn.push(`AI가 시험지에 문항이 ${tc}개 있다고 셌는데 ${baseN}개만 등록됐습니다. 서답형·서술형이 빠졌는지 시험지와 대조해 확인하세요.`);
  state.qs = qs;
  state.areas = meta.areas;
  state.notes = warn.concat(meta.notes).slice(0, 12);
  state.title = meta.title;
  state.err = 0;
  await setJob(client, examId, "solve_submit", `문항 ${qs.length}개를 찾았습니다. 풀이를 AI에 요청하는 중…`, state);
}

async function stepSolveSubmit(client: Client, examId: string, state: JobState): Promise<void> {
  const qs: QuestionMeta[] = state.qs;
  const ids = await createBatchesChunked(client, examId, state, qs.length, (i, doc) => ({
    custom_id: "q" + (i + 1),
    params: buildParams(state, doc, SOLVE_TOOL, solvePrompt(qs[i]), "high", 32000, state.tc !== "auto"),
  }));
  state.slBatches = ids;
  state.slRetry = 0;
  state.done = 0;
  state.counted = {};
  state.err = 0;
  await setJob(client, examId, "solve_wait", `문항 ${qs.length}개를 푸는 중… (AI 처리 대기, 보통 10~40분)`, state);
}

async function stepSolveWait(client: Client, examId: string, state: JobState): Promise<void> {
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throwErr("AI API 키가 없습니다.", true);
  const qs: QuestionMeta[] = state.qs;
  const total = qs.length;
  // 배치가 여러 개로 쌓였을 때(원래 풀이 + 실패 재시도) 하나씩 차례로 상태를 물어보면, 배치
  // 수가 늘어날수록 이 한 번의 tick이 배치 수 × 요청 시간만큼 길어진다. 동시에 물어봐서 이
  // 시간을 "가장 느린 배치 하나" 수준으로 줄인다.
  const batches: any[] = await Promise.all((state.slBatches as string[]).map((id) => getBatch(apiKey, id)));
  let allEnded = true;
  let okN = 0;
  for (const b of batches) {
    if (b.processing_status !== "ended") allEnded = false;
    okN += b.request_counts?.succeeded || 0;
  }
  state.done = Math.min(total, okN);
  if (!allEnded) {
    await setJob(client, examId, "solve_wait", `문항을 푸는 중… ${state.done}/${total} 완료 (AI 처리 대기)`, state);
    return;
  }

  // 배치 결과(NDJSON) 내려받기도 같은 이유로 동시에 처리한다(원래 풀이 + 실패 재시도 배치가
  // 쌓였을 때 하나씩 차례로 받아 오면 이 한 번의 tick이 오래 걸려 서버리스 함수 실행 시간
  // 제한에 걸리곤 했다). sol/why 는 tick마다 새로 계산해야 하므로(state 에 통째로 저장하면
  // 커질 수 있어 저장하지 않음) 매번 다시 받아 오되, usage 기록(state.counted)만 배치당 한 번으로 막는다.
  const sol: Record<string, any> = {};
  const why: Record<string, string> = {};
  state.counted = state.counted || {};
  const batchResults = await Promise.all(batches.map((b) => getBatchResults(apiKey, b)));
  for (let bi = 0; bi < batches.length; bi++) {
    const b = batches[bi];
    const res = batchResults[bi];
    for (const cid of Object.keys(res)) {
      const line = res[cid];
      const inp = toolInputOf(line, "submit_solution");
      if (!state.counted[b.id]) await trackUsage(client, state, line);
      if (inp) sol[cid] = inp;
      else if (!sol[cid]) why[cid] = failWhy(line);
    }
    state.counted[b.id] = true;
  }

  const missing: number[] = [];
  for (let i = 0; i < total; i++) if (!sol["q" + (i + 1)]) missing.push(i);
  if (missing.length && !state.slRetry) {
    state.slRetry = 1;
    state.tc = "auto";
    state.miss = missing.slice();
    const ids = await createBatchesChunked(client, examId, state, missing.length, (k, doc) => {
      const i2 = missing[k];
      return { custom_id: "q" + (i2 + 1), params: buildParams(state, doc, SOLVE_TOOL, solvePrompt(qs[i2]), "high", 32000, false) };
    });
    state.slBatches = [...state.slBatches, ...ids];
    await setJob(client, examId, "solve_wait", `실패한 ${missing.length}문항을 다시 요청했습니다… (AI 처리 대기)`, state);
    return;
  }

  // 예전에는 확신이 낮거나 시험지 정답과 다르게 나온 문항을 AI가 한 번 더 독립적으로 다시
  // 풀게 했다(needRecheck). 이제는 그런 문항을 과외선생님이 검토대기 큐에서 직접 풀어 고치므로
  // (submit_tutor_review) 이 재풀이 단계는 제거했다 — AI 처리 시간·비용이 줄고, 서버리스 함수
  // 실행시간 제한에 걸리던 문제(배치가 여러 개로 쌓일 때)도 근본적으로 사라진다.
  await finishExam(client, examId, state, sol, why);
}

async function finishExam(
  client: Client,
  examId: string,
  state: JobState,
  sol: Record<string, AiSolution>,
  _why: Record<string, string>
): Promise<void> {
  const qs: QuestionMeta[] = state.qs;
  const rows = qs.map((q, i) => autoCombine(q, sol["q" + (i + 1)] || null, state.areas || [], null));
  assignPoints(rows);

  const notes: string[] = [...(state.notes || [])];
  const flags: Record<string, CombinedFlag> = {};
  let sumP = 0;
  let low = 0;
  let fail = 0;

  const answerKeyRows = rows.map((r, i) => {
    sumP += r.points || 0;
    flags[r.label] = r.flag;
    if (r.flag.c === "low") low++;
    if (r.flag.c === "fail") fail++;
    for (const n of r.notes) notes.push(n);
    return {
      exam_id: examId,
      item_label: r.label,
      sort_order: i,
      correct_answers: r.answer || "(미확인)",
      points: r.points ?? 0,
      type: r.type === "mc" ? ("객관식" as const) : ("주관식" as const),
    };
  });
  const explanationRows = rows.map((r) => ({
    exam_id: examId,
    item_label: r.label,
    area: r.area,
    unit: r.unit,
    difficulty: r.diff,
    difficulty_reason: r.why,
    problem_statement: r.stmt,
    answer_display: r.disp,
    solution: r.sol,
    points_assigned: !!r.assigned,
  }));
  const correctionRows = rows
    .filter((r) => r.fix)
    .map((r) => ({ exam_id: examId, item_label: r.label, issue: r.fix!.issue, fix: r.fix!.fix }));
  if (correctionRows.length) {
    for (const r of rows) {
      if (r.fix) notes.push(r.label + "번: 시험지 오류로 판단해 정정 내용을 만들었습니다(정정본 시험지의 정오표 쪽에 실립니다). 정정이 맞는지 확인하세요.");
    }
  }

  sumP = Math.round(sumP * 10) / 10;
  if (Math.abs(sumP - 100) > 0.05) notes.push(`배점 합계가 ${sumP}점입니다(100점이 아님). 배점을 확인하세요.`);
  if (rows.some((r) => r.assigned)) {
    notes.push(
      "시험지에 배점이 인쇄되지 않은 문항은 난이도(하 1 · 중하 1.25 · 중 1.5 · 중상 1.75 · 상 2배)에 비례해 합계가 100점이 되도록 배정했습니다(문항해설의 '배점임의' 표시). 검수 화면에서 고칠 수 있습니다."
    );
  }

  // 이 시험의 기존 데이터를 지우고 새로 씀(재처리 시 이전 결과 대체)
  await client.from("answer_key").delete().eq("exam_id", examId);
  if (answerKeyRows.length) {
    const { error } = await client.from("answer_key").insert(answerKeyRows as any);
    if (error) throw error;
  }
  await client.from("item_explanations").delete().eq("exam_id", examId);
  // 해설을 다시 만들면 이전 출제오류 의심 판단은 더 이상 유효하지 않으므로 함께 정리한다.
  await client.from("item_checks").delete().eq("exam_id", examId);
  if (explanationRows.length) {
    const { error } = await client.from("item_explanations").insert(explanationRows as any);
    if (error) throw error;
  }
  // 해설을 다시 만들면 이전 출제오류 의심 판단은 더 이상 유효하지 않으므로 함께 정리한다.
  await client.from("item_checks").delete().eq("exam_id", examId);
  await client.from("exam_notes").delete().eq("exam_id", examId);
  if (notes.length) {
    const { error } = await client
      .from("exam_notes")
      .insert(notes.slice(0, 40).map((note, i) => ({ exam_id: examId, sort_order: i, note })) as any);
    if (error) throw error;
  }
  await client.from("exam_corrections").delete().eq("exam_id", examId);
  if (correctionRows.length) {
    const { error } = await client.from("exam_corrections").insert(correctionRows as any);
    if (error) throw error;
  }
  await (client.from("exams") as any).update({ status: "검수대기" }).eq("id", examId);

  state.flags = flags;
  state.err = 0;
  if (state.fileId) await deleteFile((await getAiCreds(client)).apiKey || "", state.fileId);

  const msg =
    `자동 처리가 끝났습니다. 문항 ${rows.length}개` +
    (fail ? ` 중 ${fail}개 실패` : "") +
    (low ? `, 확인 필요 ${low}개` : "") +
    " — 확인 필요 문항은 과외선생님 검토 큐에 올라갑니다. 정답을 확인하고 확정해 주세요.";
  await setJob(client, examId, "review", msg, state);
}

const STAGE_FN: Partial<Record<ExamJobStage, (client: Client, examId: string, state: JobState) => Promise<void>>> = {
  upload: stepUpload,
  extract_submit: stepExtractSubmit,
  extract_wait: stepExtractWait,
  solve_submit: stepSolveSubmit,
  solve_wait: stepSolveWait,
};

/** 진행 중인 시험을 한 걸음 진행시킨다. 무료 플랜에는 1분 단위 백그라운드 크론이 없으므로,
 *  선생님이 진행 화면을 보고 있는 동안(폴링) 이 함수가 호출될 때마다 한 단계씩 나아간다.
 *  너무 잦은 호출을 막기 위해 마지막 갱신 후 최소 시간(minIntervalMs)이 지나지 않았으면 건너뛴다. */
export async function tickExamJob(client: Client, examId: string, minIntervalMs = 2000): Promise<Job | null> {
  const job = await getJob(client, examId);
  if (!job || !isActiveStage(job.stage)) return job;
  if (Date.now() - new Date(job.updatedAt).getTime() < minIntervalMs) return job;

  const fn = STAGE_FN[job.stage];
  if (!fn) return job;
  try {
    await fn(client, examId, job.state);
  } catch (e: any) {
    const st = job.state;
    st.err = (st.err || 0) + 1;
    const msg = String(e?.message ?? e).slice(0, 300);
    // PipelineError·AiFatalError(anthropic.ts) 둘 다 fatal 속성을 쓰므로 클래스를 가리지 않고 검사한다.
    const fatal = !!(e && (e as any).fatal);
    if (fatal || st.err >= 6) {
      if (st.fileId) {
        const { apiKey } = await getAiCreds(client);
        if (apiKey) await deleteFile(apiKey, st.fileId);
      }
      await setJob(client, examId, "error", "오류: " + msg, st);
    } else {
      await setJob(client, examId, job.stage, `일시 오류로 다시 시도합니다(${st.err}/6): ${msg}`, st);
    }
  }
  return getJob(client, examId);
}
