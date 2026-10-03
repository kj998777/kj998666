"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import type { AnswerType } from "@/lib/supabase/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { regradeExam } from "@/lib/review/regrade";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { mcChoices } from "@/lib/review/mcAnswer";

async function getExamId(code: string) {
  const supabase = await createClient();
  const { data } = (await supabase.from("exams").select("id, status").eq("code", code).single()) as any;
  return data;
}

export async function addAnswerKeyRow(code: string, formData: FormData) {
  await requireRole("editor");
  const exam = await getExamId(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };

  const item_label = String(formData.get("item_label") ?? "").trim();
  const correct_answers = String(formData.get("correct_answers") ?? "").trim();
  const points = Number(formData.get("points") ?? 0);
  const type = String(formData.get("type") ?? "객관식") as AnswerType;
  const sort_order = Number(formData.get("sort_order") ?? 0);

  if (!item_label) return { ok: false, msg: "문항 번호를 입력해 주세요." };
  if (!correct_answers) return { ok: false, msg: "정답을 입력해 주세요." };
  if (!Number.isFinite(points) || points < 0) return { ok: false, msg: "배점이 올바르지 않습니다." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("answer_key")
    .insert({ exam_id: exam.id, item_label, correct_answers, points, type, sort_order } as any);

  if (error) {
    const msg = error.code === "23505" ? "이미 있는 문항 번호입니다." : "추가하지 못했습니다: " + error.message;
    return { ok: false, msg };
  }

  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

export async function updateAnswerKeyRow(
  code: string,
  id: string,
  fields: { item_label: string; correct_answers: string; points: number; type: AnswerType; sort_order: number }
) {
  await requireRole("editor");
  const supabase = await createClient();
  // 2026-10-03: 정답표를 고치면 (1) 이미 들어온 제출을 새 정답으로 다시 채점하고 (2) 해설의 정답 표시도 따라
  // 바꾼다. 그 전엔 정답표만 바뀌고 채점 결과·해설지의 "정답"은 옛 값 그대로라 셋이 서로 달랐다(원장님 제보).
  const { data: before } = (await supabase
    .from("answer_key")
    .select("exam_id, item_label, correct_answers, type")
    .eq("id", id)
    .maybeSingle()) as any;
  const { error } = await (supabase.from("answer_key") as any).update(fields).eq("id", id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };

  const notes: string[] = [];
  const keyChanged =
    !!before && (String(before.correct_answers ?? "").trim() !== fields.correct_answers.trim() || before.type !== fields.type);
  if (before && (keyChanged || before.item_label !== fields.item_label)) {
    const synced = await syncAnswerDisplayToKey(supabase, before.exam_id, fields.item_label, fields.type, fields.correct_answers);
    if (synced) notes.push(`해설의 정답 표시도 "${synced}"로 맞췄습니다.`);
  }
  if (before && keyChanged) {
    const n = await regradeExam(createAdminClient(), before.exam_id);
    if (n > 0) notes.push(`제출 ${n}건을 새 정답으로 다시 채점했습니다.`);
  }
  revalidatePath(`/exams/${code}`);
  revalidatePath(`/exams/${code}/results`);
  return { ok: true, msg: notes.join(" ") };
}

/**
 * 해설의 정답 표시(item_explanations.answer_display)가 정답표와 다르면 정답표 모양("③", "1/2")으로 바꾼다.
 * 바꿨으면 새 표시를, 안 바꿨으면(이미 같거나 해설 행이 없으면) null을 돌려준다. AI 원본은 ai_answer_display에 남긴다.
 */
async function syncAnswerDisplayToKey(supabase: any, examId: string, itemLabel: string, type: string, keyCell: string): Promise<string | null> {
  const { data: ie } = (await supabase
    .from("item_explanations")
    .select("id, answer_display, ai_answer_display")
    .eq("exam_id", examId)
    .eq("item_label", itemLabel)
    .maybeSingle()) as any;
  if (!ie) return null;
  const { mismatch, text } = reconcileKeyDisplay(type, keyCell, ie.answer_display);
  if (!mismatch) return null;
  const patch: Record<string, unknown> = { answer_display: text, updated_at: new Date().toISOString() };
  if (ie.ai_answer_display == null) patch.ai_answer_display = ie.answer_display ?? "";
  const { error } = await (supabase.from("item_explanations") as any).update(patch).eq("id", ie.id);
  return error ? null : text;
}

export async function deleteAnswerKeyRow(code: string, id: string) {
  await requireRole("editor");
  const supabase = await createClient();
  const { error } = await supabase.from("answer_key").delete().eq("id", id);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

/**
 * 문항 해설(정답표시·풀이 등) 직접 수정. AnswerKeyRow/updateAnswerKeyRow와 완전히 같은 모양.
 * 직원(editor 이상)은 포인트·큐 개념 없이 바로 고친다 — 과외선생님용 검토 제출(submit_tutor_review
 * RPC)과는 별개의 단순 경로다. RLS(item_explanations_update_editor_or_admin)가 이미 허용한다.
 */
export async function updateItemExplanation(
  code: string,
  id: string,
  fields: { answer_display: string; solution: string; problem_statement?: string }
) {
  await requireRole("editor");
  const supabase = await createClient();
  // 2026-10-03: 정답 표시가 정답표(채점 기준)와 다르게 저장되는 걸 막는다. 정답을 바꾸려면 위 정답표에서 고쳐야
  // 하고, 그러면 정답 표시도 자동으로 따라온다(updateAnswerKeyRow). 주관식은 수식 모양 때문에 비교가 틀릴 수
  // 있어 막지는 않고 안내만 한다(보고서에는 어차피 정답표 쪽이 보인다).
  let warn = "";
  const { data: ie } = (await supabase.from("item_explanations").select("exam_id, item_label").eq("id", id).maybeSingle()) as any;
  if (ie) {
    const { data: key } = (await supabase
      .from("answer_key")
      .select("correct_answers, type")
      .eq("exam_id", ie.exam_id)
      .eq("item_label", ie.item_label)
      .maybeSingle()) as any;
    const disp = fields.answer_display.trim();
    if (key && disp && String(key.correct_answers ?? "").trim()) {
      const { mismatch, text } = reconcileKeyDisplay(key.type, key.correct_answers, disp);
      if (mismatch && key.type === "객관식" && mcChoices(disp)) {
        return {
          ok: false,
          msg: `정답표는 ${text}입니다. 정답을 바꾸려면 위 정답표에서 고쳐 주세요(해설의 정답 표시도 함께 바뀝니다).`,
        };
      }
      if (mismatch) warn = `정답표("${key.correct_answers}")와 같은 값인지 확인해 주세요 — 다르면 해설지·보고서에는 정답표 쪽이 보입니다.`;
    }
  }
  const { error } = await (supabase.from("item_explanations") as any).update(fields).eq("id", id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true, msg: warn };
}

/**
 * 과외선생님 스토어에서 이 시험을 몇 포인트에 팔지 지정. null이면 판매 대상에서 뺀다.
 * #1: 검토가 끝나 정답이 확정된("열림") 시험만 스토어에 등록할 수 있다 — 지금까지는 화면
 * (page.tsx)에서만 '닫힘' 상태일 때 입력칸을 보여주는 식이었고 여기(서버 액션)에는 상태 검사가
 * 전혀 없어 다른 상태에서도 직접 호출하면 등록이 가능한 허점이 있었다. 판매를 그만두는(cost=null)
 * 요청은 상태와 무관하게 항상 허용한다(이미 열림이 아닌 시험도 판매 중단은 언제든 할 수 있어야
 * 하므로).
 */
export async function updateTutorDownloadCost(code: string, cost: number | null) {
  await requireRole("editor");
  if (cost !== null && (!Number.isFinite(cost) || cost <= 0)) {
    return { ok: false, msg: "포인트는 0보다 큰 숫자여야 합니다." };
  }
  const supabase = await createClient();
  if (cost !== null) {
    const exam = await getExamId(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    if (exam.status !== "열림") {
      return { ok: false, msg: "검토가 끝나 '열림' 상태인 시험만 스토어에 등록할 수 있습니다." };
    }
  }
  const { error } = await (supabase.from("exams") as any)
    .update({ tutor_download_cost: cost })
    .eq("code", code);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

/** 시험 열기/닫기 — 관리자 전용(사용자 명시적 결정). DB 트리거도 같은 규칙을 한 번 더 강제한다. */
export async function toggleExamStatus(code: string, open: boolean) {
  await requireRole("admin");
  const supabase = await createClient();

  if (open) {
    const { count } = await supabase
      .from("answer_key")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", (await getExamId(code))?.id ?? "");
    if (!count) return { ok: false, msg: "정답이 아직 없는 시험은 열 수 없습니다." };
  }

  const { error } = await (supabase
    .from("exams") as any)
    .update({ status: open ? "열림" : "닫힘" })
    .eq("code", code);

  if (error) return { ok: false, msg: "바꾸지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  revalidatePath("/exams");
  return { ok: true };
}

/** 2026-09-29: 이 시험 원본 PDF 속 QR 위치를 (다시) AI로 찾게 한다(관리자). 결과는 크론이 몇 분 안에 채운다. */
export async function rescanExamQr(code: string) {
  await requireRole("admin");
  const exam = await getExamId(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const { enqueueQrScan } = await import("@/lib/ai/qrMask");
  const queued = await enqueueQrScan(null, exam.id, { force: true });
  revalidatePath(`/exams/${code}`);
  return queued
    ? { ok: true, msg: "QR 찾기를 걸었습니다. 보통 몇 분 안에 끝나며, 끝나면 PDF에서 자동으로 가려집니다." }
    : { ok: false, msg: "이미 찾는 중이거나, 데이터베이스 마이그레이션 0031이 아직 적용되지 않았습니다." };
}
