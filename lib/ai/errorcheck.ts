import "server-only";
import type { ItemCheckStage } from "@/lib/supabase/types";
import {
  aiCreditKind,
  aiErr,
  cancelBatch,
  createBatch,
  failWhy,
  getBatch,
  getBatchResults,
  toolInputOf,
  addUsage,
} from "./anthropic";
import { ERROR_CHECK_TOOL, errorCheckPrompt } from "./prompts";
import { getExamPdfBuffer } from "./pdf";
import { getAiCreds, recordLowBalanceAlert, recordUsage, clearLowBalanceAlert } from "./settings";

// 문항별 "출제오류 의심" AI 판단. Apps Script v37의 eq 파이프라인(같은 해설재작성 큐, 문항 1개당
// 요청 1건)을 옮긴 것. 시험 전체 배치(pipeline.ts)와 달리 문항 하나만 즉시 확인하면 되므로 파일
// 업로드 없이 PDF를 매 요청에 직접 실어(inline) 보낸다 — 관리자가 필요할 때만 누르는 저빈도 기능
// 이라 Files API 캐싱을 따로 관리할 만큼의 이득이 없다.

type Client = any;
type State = Record<string, any>;

const ACTIVE: ItemCheckStage[] = ["rx_submit", "rx_wait"];
export function isActiveCheckStage(stage: ItemCheckStage): boolean {
  return ACTIVE.includes(stage);
}

export type ItemCheck = { examId: string; label: string; stage: ItemCheckStage; message: string; state: State; updatedAt: string };

export async function getItemCheck(client: Client, examId: string, label: string): Promise<ItemCheck | null> {
  const { data, error } = (await client
    .from("item_checks")
    .select("*")
    .eq("exam_id", examId)
    .eq("item_label", label)
    .maybeSingle()) as any;
  if (error) throw error;
  if (!data) return null;
  return { examId: data.exam_id, label: data.item_label, stage: data.stage, message: data.message, state: data.state, updatedAt: data.updated_at };
}

async function setCheck(client: Client, examId: string, label: string, stage: ItemCheckStage, message: string, state: State): Promise<void> {
  const { error } = await (client.from("item_checks") as any).upsert(
    { exam_id: examId, item_label: label, stage, message: message.slice(0, 500), state },
    { onConflict: "exam_id,item_label" }
  );
  if (error) throw error;
}

export async function discardErrorCheck(client: Client, examId: string, label: string): Promise<void> {
  await client.from("item_checks").delete().eq("exam_id", examId).eq("item_label", label);
}

/** 선생님이 직접 표시/해제한다(AI 없이). on=false면 표시를 지운다. */
export async function setErrorFlag(
  client: Client,
  examId: string,
  label: string,
  on: boolean,
  why: string
): Promise<{ ok: true } | { ok: false; msg: string }> {
  const { data: item, error: findErr } = (await client
    .from("item_explanations")
    .select("id")
    .eq("exam_id", examId)
    .eq("item_label", label)
    .maybeSingle()) as any;
  if (findErr) throw findErr;
  if (!item) return { ok: false, msg: "문항 해설을 찾을 수 없습니다." };

  const update = on
    ? {
        exam_error_suspected: true,
        exam_error_kind: "기타",
        exam_error_reason: (why || "선생님이 직접 표시했습니다.").slice(0, 1000),
        exam_error_student_note: "",
      }
    : { exam_error_suspected: false, exam_error_kind: "", exam_error_reason: "", exam_error_student_note: "" };
  const { error } = await (client.from("item_explanations") as any).update(update).eq("id", item.id);
  if (error) throw error;
  // 표시를 바꾸면 AI 판단이 진행 중이었더라도 의미가 없으므로 정리한다(재검토는 다시 눌러 시작).
  await discardErrorCheck(client, examId, label);
  return { ok: true };
}

/** AI 판단을 시작한다. */
export async function startErrorCheck(
  client: Client,
  examId: string,
  label: string,
  hint: string
): Promise<{ ok: true } | { ok: false; msg: string }> {
  const existing = await getItemCheck(client, examId, label);
  if (existing && isActiveCheckStage(existing.stage)) return { ok: false, msg: "이미 확인 중입니다." };

  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 아직 저장되지 않았습니다. AI 설정에서 키를 먼저 저장해 주세요." };

  const { data: item, error } = (await client
    .from("item_explanations")
    .select("problem_statement, solution")
    .eq("exam_id", examId)
    .eq("item_label", label)
    .maybeSingle()) as any;
  if (error) throw error;
  if (!item) return { ok: false, msg: "문항 해설을 찾을 수 없습니다(먼저 AI 자동 처리로 해설을 만들어야 합니다)." };

  const state: State = { model, hint: (hint || "").slice(0, 300), started: new Date().toISOString() };
  await setCheck(client, examId, label, "rx_submit", "출제오류 의심 여부를 AI가 확인하는 중… (요청 준비)", state);
  return { ok: true };
}

async function stepSubmit(client: Client, examId: string, label: string, state: State): Promise<void> {
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throw Object.assign(new Error("AI API 키가 없습니다."), { fatal: true });

  const { data: item, error } = (await client
    .from("item_explanations")
    .select("problem_statement, solution")
    .eq("exam_id", examId)
    .eq("item_label", label)
    .maybeSingle()) as any;
  if (error) throw error;
  if (!item) throw Object.assign(new Error("문항 해설을 찾을 수 없습니다."), { fatal: true });

  const buf = await getExamPdfBuffer(client, examId);
  const b64 = buf.toString("base64");
  const doc = { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, cache_control: { type: "ephemeral" } };
  const prompt = errorCheckPrompt(label, item.problem_statement || "", item.solution || "", state.hint || "");

  const r = await createBatch(apiKey, [
    {
      custom_id: "eq",
      params: {
        model: state.model,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        tools: [ERROR_CHECK_TOOL],
        tool_choice: { type: "tool", name: ERROR_CHECK_TOOL.name },
        messages: [{ role: "user", content: [doc, { type: "text", text: prompt }] }],
      },
    },
  ]);
  const kind = aiCreditKind(r);
  if (kind) {
    await recordLowBalanceAlert(
      client,
      kind,
      String(r.json?.error?.message || r.text || "").slice(0, 300)
    );
    throw Object.assign(
      new Error(
        kind === "credit"
          ? "Anthropic 크레딧이 부족해 요청이 거절됐습니다. 크레딧을 충전한 뒤 다시 시도해 주세요."
          : "Anthropic API 사용 한도에 도달했습니다. 한도가 풀린 뒤 다시 시도해 주세요."
      ),
      { fatal: true }
    );
  }
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("API 키 인증 실패: " + aiErr(r)), { fatal: true });
  if (r.status !== 200 || !r.json?.id) throw new Error("요청 실패: " + aiErr(r));
  await clearLowBalanceAlert(client);
  state.batch = r.json.id;
  await setCheck(client, examId, label, "rx_wait", "출제오류 의심 여부를 AI가 확인하는 중… (몇 분~수십 분)", state);
}

async function stepWait(client: Client, examId: string, label: string, state: State): Promise<void> {
  const { apiKey } = await getAiCreds(client);
  if (!apiKey) throw Object.assign(new Error("AI API 키가 없습니다."), { fatal: true });
  const b = await getBatch(apiKey, state.batch);
  if (b.processing_status !== "ended") {
    await setCheck(client, examId, label, "rx_wait", "출제오류 의심 여부를 AI가 확인하는 중… (AI 처리 대기)", state);
    return;
  }
  const results = await getBatchResults(apiKey, b);
  const line = results["eq"];
  const usage = state.usage || { i: 0, o: 0 };
  const delta = addUsage(usage, line);
  state.usage = usage;
  if (delta) await recordUsage(client, state.model, delta.di, delta.dO);

  const input = toolInputOf(line, "submit_error_check");
  if (!input) {
    throw new Error("AI 판단 결과를 받지 못했습니다: " + failWhy(line));
  }

  const suspect = input.verdict === "suspect";
  const { data: item, error: findErr } = (await client
    .from("item_explanations")
    .select("id")
    .eq("exam_id", examId)
    .eq("item_label", label)
    .maybeSingle()) as any;
  if (findErr) throw findErr;
  if (item) {
    const update = suspect
      ? {
          exam_error_suspected: true,
          exam_error_kind: String(input.kind || "기타").slice(0, 20),
          exam_error_reason: String(input.reason || "").slice(0, 2000),
          exam_error_student_note: String(input.student_note || "").slice(0, 300),
        }
      : { exam_error_suspected: false, exam_error_kind: "", exam_error_reason: "", exam_error_student_note: "" };
    const { error: upErr } = await (client.from("item_explanations") as any).update(update).eq("id", item.id);
    if (upErr) throw upErr;
  }

  state.verdict = input.verdict;
  state.reason = input.reason;
  state.answer = input.answer || "";
  state.confidence = input.confidence || "";
  await setCheck(
    client,
    examId,
    label,
    "rx_done",
    suspect ? "AI가 출제오류로 의심된다고 판단했습니다(해설에 자동 표시됨)." : "AI는 출제오류로 보이지 않는다고 판단했습니다.",
    state
  );
}

const STAGE_FN: Partial<Record<ItemCheckStage, (client: Client, examId: string, label: string, state: State) => Promise<void>>> = {
  rx_submit: stepSubmit,
  rx_wait: stepWait,
};

/** 폴링 때마다 한 걸음 진행(exam_jobs의 tickExamJob과 같은 lazy tick 패턴). */
export async function tickErrorCheck(client: Client, examId: string, label: string, minIntervalMs = 2000): Promise<ItemCheck | null> {
  const check = await getItemCheck(client, examId, label);
  if (!check || !isActiveCheckStage(check.stage)) return check;
  if (Date.now() - new Date(check.updatedAt).getTime() < minIntervalMs) return check;

  const fn = STAGE_FN[check.stage];
  if (!fn) return check;
  try {
    await fn(client, examId, label, check.state);
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    const fatal = !!(e && (e as any).fatal);
    const st = check.state;
    st.err = (st.err || 0) + 1;
    if (fatal || st.err >= 4) {
      await setCheck(client, examId, label, "rx_error", "오류: " + msg, st);
    } else {
      await setCheck(client, examId, label, check.stage, `일시 오류로 다시 시도합니다(${st.err}/4): ${msg}`, st);
    }
  }
  return getItemCheck(client, examId, label);
}

export async function cancelErrorCheck(client: Client, examId: string, label: string): Promise<{ ok: true } | { ok: false; msg: string }> {
  const check = await getItemCheck(client, examId, label);
  if (!check || !isActiveCheckStage(check.stage)) return { ok: false, msg: "진행 중인 확인이 없습니다." };
  const { apiKey } = await getAiCreds(client);
  if (apiKey && check.state.batch) await cancelBatch(apiKey, check.state.batch);
  await discardErrorCheck(client, examId, label);
  return { ok: true };
}

