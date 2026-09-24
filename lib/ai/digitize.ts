import "server-only";
import type { DigitizeJobStage } from "@/lib/supabase/types";
import {
    AiCallResult,
    BatchRequest,
    addUsage,
    aiCreditKind,
    aiErr,
    cancelBatch,
    createBatch,
    deleteFile,
    getBatch,
    getBatchResults,
    toolInputOf,
    uploadPdfFile,
} from "./anthropic";
import { DG_TOOL, dgPrompt } from "./prompts";
import { getExamPdfBuffer } from "./pdf";
import { countPdfPages } from "./pdfMeta";
import { clearLowBalanceAlert, getAiCreds, recordLowBalanceAlert, recordUsage } from "./settings";

// 스캔 시험지 디지털화(Feature 1). exam_jobs/pipeline.ts와 같은 "lazy tick" 상태 기계 패턴을
// digitize_jobs/digitized_pages 테이블에 그대로 적용한 것 — 다만 문항 단위가 아니라 쪽(page) 단위로
// 배치를 나눈다(한 쪽에 여러 문항이 있어도 한 번에 옮겨 적게 하는 편이 배치 수를 줄이고 문항이
// 쪽 경계를 걸치는 경우도 자연스럽게 처리됨).
//
// v1 범위: 각 쪽을 글자·수식·그림 위치(DG_TOOL의 submit_page 스키마) 구조화 데이터로 옮겨 적어
// digitized_pages에 저장하는 데까지만 한다. 그 데이터로 깔끔한 새 PDF를 실제로 조판해 주는 기능
// (그림 잘라 붙이기 포함)은 별도 렌더러가 필요한 훨씬 큰 작업이라 이번 v1에서는 만들지 않았고,
// 관리자는 결과를 JSON으로 내려받아 검토/재사용할 수 있다(다음 단계로 남겨 둠).

type Client = any;
type State = Record<string, any>;

const ACTIVE: DigitizeJobStage[] = ["dg_upload", "dg_submit", "dg_wait"];
export function isActiveDgStage(stage: DigitizeJobStage): boolean {
    return ACTIVE.includes(stage);
}

export type DigitizeJob = { examId: string; stage: DigitizeJobStage; message: string; state: State; updatedAt: string };

export async function getDigitizeJob(client: Client, examId: string): Promise<DigitizeJob | null> {
    const { data, error } = (await client.from("digitize_jobs").select("*").eq("exam_id", examId).maybeSingle()) as any;
    if (error) throw error;
    if (!data) return null;
    return { examId: data.exam_id, stage: data.stage, message: data.message, state: data.state, updatedAt: data.updated_at };
}

async function setDgJob(client: Client, examId: string, stage: DigitizeJobStage, message: string, state: State): Promise<void> {
    const json = JSON.stringify(state ?? {});
    if (json.length > 200000) throw new Error("작업 상태가 너무 커서 저장하지 못했습니다.");
    const { error } = await (client.from("digitize_jobs") as any).upsert(
      { exam_id: examId, stage, message: message.slice(0, 500), state: state ?? {} },
      { onConflict: "exam_id" }
        );
    if (error) throw error;
}

function throwErr(msg: string, fatal = false): never {
    throw Object.assign(new Error(msg), { fatal });
}

async function checkCredit(client: Client, r: AiCallResult): Promise<void> {
    const kind = aiCreditKind(r);
    if (!kind) return;
    const msg =
          kind === "credit"
        ? "Anthropic 크레딧이 부족해 요청이 거절됐습니다. 크레딧을 충전한 뒤 디지털화를 다시 시작해 주세요."
            : "Anthropic API 사용 한도에 도달했습니다. 한도가 풀린 뒤 디지털화를 다시 시작해 주세요.";
    await recordLowBalanceAlert(client, kind, String(r.json?.error?.message || r.text || "").slice(0, 300));
    throwErr(msg, true);
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

/** pipeline.ts의 createBatchesChunked와 같은 패턴: 파일 참조가 거절되면 PDF를 직접 실어(inline) 나눠 보낸다. */
async function createBatchesChunked(
    client: Client,
    examId: string,
    state: State,
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

async function trackUsage(client: Client, state: State, line: any): Promise<void> {
    state.usage = state.usage || { i: 0, o: 0 };
    const delta = addUsage(state.usage, line);
    if (delta) await recordUsage(client, state.model, delta.di, delta.dO);
}

// ---------------------------------------------------------------------
// 시작 / 취소
// ---------------------------------------------------------------------

export async function startDigitizeJob(client: Client, examId: string): Promise<{ ok: true } | { ok: false; msg: string }> {
    const { apiKey, model } = await getAiCreds(client);
    if (!apiKey) return { ok: false, msg: "AI API 키가 아직 저장되지 않았습니다. AI 설정에서 키를 먼저 저장해 주세요." };

  const existing = await getDigitizeJob(client, examId);
    if (existing && isActiveDgStage(existing.stage)) return { ok: false, msg: "이미 디지털화 중입니다." };

  const { data: meta } = (await client.from("exam_pdf_meta").select("exam_id").eq("exam_id", examId).maybeSingle()) as any;
    if (!meta) return { ok: false, msg: "먼저 시험지 PDF를 올려 주세요." };

  // 다시 시작하면 이전 결과는 더 이상 맞지 않으므로(쪽수가 바뀌었을 수도 있음) 지우고 새로 만든다.
  await client.from("digitized_pages").delete().eq("exam_id", examId);

  const state: State = { model, started: new Date().toISOString(), usage: { i: 0, o: 0 }, err: 0 };
    await setDgJob(client, examId, "dg_upload", "시험지를 AI에 올리는 중…", state);
    return { ok: true };
}

export async function cancelDigitizeJob(client: Client, examId: string): Promise<{ ok: true } | { ok: false; msg: string }> {
    const job = await getDigitizeJob(client, examId);
    if (!job || !isActiveDgStage(job.stage)) return { ok: false, msg: "진행 중인 디지털화가 없습니다." };
    const { apiKey } = await getAiCreds(client);
    const state = job.state;
    if (apiKey) for (const id of state.batches || []) await cancelBatch(apiKey, id);
    await setDgJob(client, examId, "dg_error", "선생님이 디지털화를 취소했습니다.", state);
    return { ok: true };
}

// ---------------------------------------------------------------------
// 단계별 진행
// ---------------------------------------------------------------------

async function stepUpload(client: Client, examId: string, state: State): Promise<void> {
    const buf = await getExamPdfBuffer(client, examId);
    const { apiKey } = await getAiCreds(client);
    if (!apiKey) throwErr("AI API 키가 아직 저장되지 않았습니다.", true);

  const pages = await countPdfPages(buf);
    if (!pages || pages < 1) throwErr("PDF 쪽수를 확인하지 못했습니다.", true);
    if (pages > 60) throwErr(`쪽수가 너무 많습니다(${pages}쪽). 60쪽 이하 시험지만 지원합니다.`, true);
    state.totalPages = pages;

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
    await setDgJob(
          client,
          examId,
          "dg_submit",
          how === "file" ? `총 ${pages}쪽을 옮겨 적도록 요청하는 중…` : `총 ${pages}쪽을 옮겨 적도록 요청하는 중… (직접 첨부 방식)`,
          state
        );
}

async function stepSubmit(client: Client, examId: string, state: State): Promise<void> {
    const total: number = state.totalPages;
    const ids = await createBatchesChunked(client, examId, state, total, (i, doc) => ({
          custom_id: "p" + (i + 1),
          params: {
                  model: state.model,
                  max_tokens: 16000,
                  thinking: { type: "adaptive" },
                  output_config: { effort: "medium" },
                  tools: [DG_TOOL],
                  tool_choice: { type: "tool", name: DG_TOOL.name },
                  messages: [{ role: "user", content: [doc, { type: "text", text: dgPrompt(i + 1, total) }] }],
          },
    }));
    state.batches = ids;
    state.retry = 0;
    state.counted = {};
    state.err = 0;
    await setDgJob(client, examId, "dg_wait", `${total}쪽을 옮겨 적는 중… (AI 처리 대기, 보통 10~40분)`, state);
}

async function savePage(client: Client, examId: string, pageNo: number, data: unknown): Promise<void> {
    const { error } = await (client.from("digitized_pages") as any).upsert(
      { exam_id: examId, page_no: pageNo, data },
      { onConflict: "exam_id,page_no" }
        );
    if (error) throw error;
}

async function stepWait(client: Client, examId: string, state: State): Promise<void> {
    const { apiKey } = await getAiCreds(client);
    if (!apiKey) throwErr("AI API 키가 없습니다.", true);
    const total: number = state.totalPages;
    const batches: any[] = [];
    let allEnded = true;
    let okN = 0;
    for (const id of state.batches as string[]) {
          const b = await getBatch(apiKey, id);
          batches.push(b);
          if (b.processing_status !== "ended") allEnded = false;
          okN += b.request_counts?.succeeded || 0;
    }
    state.done = Math.min(total, okN);
    if (!allEnded) {
          await setDgJob(client, examId, "dg_wait", `${total}쪽 중 ${state.done}쪽 완료 (AI 처리 대기)`, state);
          return;
    }

  const results: Record<string, any> = {};
    state.counted = state.counted || {};
    for (const b of batches) {
          const res = await getBatchResults(apiKey, b);
          for (const cid of Object.keys(res)) {
                  const line = res[cid];
                  if (!state.counted[b.id]) await trackUsage(client, state, line);
                  results[cid] = line;
          }
          state.counted[b.id] = true;
    }

  const missing: number[] = [];
    for (let i = 0; i < total; i++) {
          const line = results["p" + (i + 1)];
          const input = line ? toolInputOf(line, "submit_page") : null;
          if (input) await savePage(client, examId, i + 1, input);
          else missing.push(i);
    }

  if (missing.length && !state.retry) {
        state.retry = 1;
        const ids = await createBatchesChunked(client, examId, state, missing.length, (k, doc) => {
                const i2 = missing[k];
                return {
                          custom_id: "p" + (i2 + 1),
                          params: {
                                      model: state.model,
                                      max_tokens: 16000,
                                      thinking: { type: "adaptive" },
                                      output_config: { effort: "medium" },
                                      tools: [DG_TOOL],
                                      tool_choice: { type: "tool", name: DG_TOOL.name },
                                      messages: [{ role: "user", content: [doc, { type: "text", text: dgPrompt(i2 + 1, total) }] }],
                          },
                };
        });
        state.batches = [...state.batches, ...ids];
        await setDgJob(client, examId, "dg_wait", `실패한 ${missing.length}쪽을 다시 요청했습니다… (AI 처리 대기)`, state);
        return;
  }

  state.err = 0;
    if (state.fileId) await deleteFile(apiKey, state.fileId);
    const stillMissing = missing.length; // 재시도까지 했는데도 남은 개수(위에서 state.retry가 이미 1이면 missing이 곧 최종 실패)
  const msg = stillMissing
      ? `디지털화가 끝났습니다. ${total}쪽 중 ${total - stillMissing}쪽 성공, ${stillMissing}쪽 실패했습니다(다시 시작하면 처음부터 다시 시도합니다).`
        : `디지털화가 끝났습니다. 총 ${total}쪽을 모두 옮겨 적었습니다.`;
    await setDgJob(client, examId, "dg_done", msg, state);
}

const STAGE_FN: Partial<Record<DigitizeJobStage, (client: Client, examId: string, state: State) => Promise<void>>> = {
    dg_upload: stepUpload,
    dg_submit: stepSubmit,
    dg_wait: stepWait,
};

/** exam_jobs의 tickExamJob과 같은 lazy tick 패턴 — 폴링 때마다 한 걸음 진행. */
export async function tickDigitizeJob(client: Client, examId: string, minIntervalMs = 2000): Promise<DigitizeJob | null> {
    const job = await getDigitizeJob(client, examId);
    if (!job || !isActiveDgStage(job.stage)) return job;
    if (Date.now() - new Date(job.updatedAt).getTime() < minIntervalMs) return job;

  const fn = STAGE_FN[job.stage];
    if (!fn) return job;
    try {
          await fn(client, examId, job.state);
    } catch (e: any) {
          const st = job.state;
          st.err = (st.err || 0) + 1;
          const msg = String(e?.message ?? e).slice(0, 300);
          const fatal = !!(e && (e as any).fatal);
          if (fatal || st.err >= 6) {
                  if (st.fileId) {
                            const { apiKey } = await getAiCreds(client);
                            if (apiKey) await deleteFile(apiKey, st.fileId);
                  }
                  await setDgJob(client, examId, "dg_error", "오류: " + msg, st);
          } else {
                  await setDgJob(client, examId, job.stage, `일시 오류로 다시 시도합니다(${st.err}/6): ${msg}`, st);
          }
    }
    return getDigitizeJob(client, examId);
}
