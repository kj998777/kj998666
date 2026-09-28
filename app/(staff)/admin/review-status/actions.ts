"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openExamIfAllConfirmed, tutorAnswerMatches } from "@/lib/review/confirm";
import { regradeExam } from "@/lib/review/regrade";

// #3 관리자 검토현황 — 문항별 정답 확정. 확정되면 그 문항은 과외선생님 검토 큐에서도 빠지고
// (tutor_reviewed=true), 시험의 모든 문항이 확정되면 검수대기 시험이 자동으로 열린다.

type Result = { ok: boolean; msg?: string; examOpened?: boolean };

async function loadItem(supabase: any, itemId: string) {
  const { data: ie } = (await supabase
    .from("item_explanations")
    .select("id, exam_id, item_label, ai_answer_display, ai_solution")
    .eq("id", itemId)
    .maybeSingle()) as any;
  if (!ie) return null;
  const [{ data: key }, { data: exam }] = await Promise.all([
    supabase
      .from("answer_key")
      .select("id, correct_answers, type")
      .eq("exam_id", ie.exam_id)
      .eq("item_label", ie.item_label)
      .maybeSingle(),
    supabase.from("exams").select("code").eq("id", ie.exam_id).maybeSingle(),
  ]);
  return { ie, key: key as any, code: (exam as any)?.code as string | undefined };
}

async function markConfirmed(supabase: any, itemIds: string[], userId: string, source: "admin" | "auto_match") {
  const { error } = await (supabase.from("item_explanations") as any)
    .update({
      review_confirmed: true,
      review_confirm_source: source,
      review_confirmed_by: userId,
      review_confirmed_at: new Date().toISOString(),
      // 확정된 문항은 과외선생님 검토 큐에서 뺀다(아직 아무도 안 풀었어도).
      tutor_reviewed: true,
      claimed_by: null,
      claim_expires_at: null,
    })
    .in("id", itemIds);
  return error;
}

function refresh(code?: string) {
  revalidatePath("/admin/review-status");
  revalidatePath("/exams");
  if (code) revalidatePath(`/exams/${code}`);
}

/** 입력한 정답으로 확정. 정답표와 다르면 정답표(answer_key)도 이 값으로 바꾼다. */
export async function confirmItem(itemId: string, answer: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const value = answer.trim();
  if (!value) return { ok: false, msg: "정답을 입력해 주세요." };
  if (value.length > 200) return { ok: false, msg: "정답이 너무 깁니다." };

  const supabase = await createClient();
  const loaded = await loadItem(supabase, itemId);
  if (!loaded) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const { ie, key, code } = loaded;

  let keyChanged = false;
  if (key) {
    if (key.correct_answers !== value) {
      const { error } = await (supabase.from("answer_key") as any).update({ correct_answers: value }).eq("id", key.id);
      if (error) return { ok: false, msg: "정답표를 고치지 못했습니다: " + error.message };
      keyChanged = true;
    }
  } else {
    return { ok: false, msg: "이 문항의 정답표 줄이 없습니다. 시험 상세에서 먼저 정답을 추가해 주세요." };
  }

  const err = await markConfirmed(supabase, [ie.id], userId, "admin");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  // 정답이 바뀌었으면 이미 들어온 제출(있다면)을 새 정답으로 다시 채점
  if (keyChanged) await regradeExam(createAdminClient(), ie.exam_id);

  const examOpened = await openExamIfAllConfirmed(supabase, ie.exam_id);
  refresh(code);
  return { ok: true, examOpened };
}

/**
 * 과외선생님 답이 틀렸다고 보고 AI 정답을 유지 — 정답표는 그대로 두고, 과외선생님 제출로 덮어써진
 * 해설(정답 표시·풀이)을 AI 원본으로 되돌린 뒤 확정한다(0016 이전 제출이라 원본이 없으면 해설은 그대로).
 */
export async function keepAiAnswer(itemId: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const loaded = await loadItem(supabase, itemId);
  if (!loaded) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const { ie, code } = loaded;

  if (ie.ai_answer_display != null || ie.ai_solution != null) {
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (ie.ai_answer_display != null) patch.answer_display = ie.ai_answer_display;
    if (ie.ai_solution != null) patch.solution = ie.ai_solution;
    const { error } = await (supabase.from("item_explanations") as any).update(patch).eq("id", ie.id);
    if (error) return { ok: false, msg: "AI 해설로 되돌리지 못했습니다: " + error.message };
  }

  const err = await markConfirmed(supabase, [ie.id], userId, "admin");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  const examOpened = await openExamIfAllConfirmed(supabase, ie.exam_id);
  refresh(code);
  return { ok: true, examOpened };
}

/** 과외선생님 답이 정답표와 같은데 아직 확정 안 된 문항(0016 이전 제출분 등)을 한 번에 확정. */
export async function confirmMatchedItems(examId: string): Promise<Result & { count?: number }> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();

  const [{ data: items }, { data: keys }, { data: exam }] = await Promise.all([
    supabase
      .from("item_explanations")
      .select("id, item_label, answer_display, tutor_reviewed, review_confirmed")
      .eq("exam_id", examId)
      .eq("review_confirmed", false)
      .eq("tutor_reviewed", true),
    supabase.from("answer_key").select("item_label, correct_answers, type").eq("exam_id", examId),
    supabase.from("exams").select("code").eq("id", examId).maybeSingle(),
  ]);
  const keyByLabel = new Map(((keys as any[]) ?? []).map((k) => [k.item_label, k]));
  const ids = ((items as any[]) ?? [])
    .filter((it) => {
      const k = keyByLabel.get(it.item_label);
      return k && tutorAnswerMatches(k.type, it.answer_display, k.correct_answers);
    })
    .map((it) => it.id);

  if (ids.length === 0) return { ok: true, count: 0 };
  const err = await markConfirmed(supabase, ids, userId, "auto_match");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  const examOpened = await openExamIfAllConfirmed(supabase, examId);
  refresh((exam as any)?.code);
  return { ok: true, count: ids.length, examOpened };
}

// -------------------------------------------------------------------------
// #4: 과외선생님 해설·정답 수정 요청 — 채택/거절
// -------------------------------------------------------------------------

/**
 * 수정 요청 채택. answer(관리자가 입력칸에서 최종 확인한 정답표 값)가 지금 정답과 다르면 정답표를 바꾸고
 * 기존 제출을 다시 채점한다. 요청에 해설이 있으면 해설도 바꾼다.
 */
export async function acceptEditRequest(requestId: string, answer: string): Promise<Result & { regraded?: number }> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const { data: req } = (await (supabase.from("tutor_edit_requests") as any)
    .select("id, exam_id, item_label, proposed_answer, proposed_solution, status")
    .eq("id", requestId)
    .maybeSingle()) as any;
  if (!req) return { ok: false, msg: "요청을 찾을 수 없습니다." };
  if (req.status !== "pending") return { ok: false, msg: "이미 처리한 요청입니다." };

  const [{ data: key }, { data: exam }]: any[] = await Promise.all([
    supabase.from("answer_key").select("id, correct_answers").eq("exam_id", req.exam_id).eq("item_label", req.item_label).maybeSingle(),
    supabase.from("exams").select("code").eq("id", req.exam_id).maybeSingle(),
  ]);
  if (!key) return { ok: false, msg: "정답표에서 이 문항을 찾을 수 없습니다." };

  const value = answer.trim();
  let keyChanged = false;
  if (value && value !== key.correct_answers) {
    if (value.length > 200) return { ok: false, msg: "정답이 너무 깁니다." };
    const { error } = await (supabase.from("answer_key") as any).update({ correct_answers: value }).eq("id", key.id);
    if (error) return { ok: false, msg: "정답표를 고치지 못했습니다: " + error.message };
    keyChanged = true;
  }

  const patch: Record<string, string> = {};
  if (req.proposed_solution) patch.solution = req.proposed_solution;
  if (req.proposed_answer && keyChanged) patch.answer_display = req.proposed_answer;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await (supabase.from("item_explanations") as any)
      .update(patch)
      .eq("exam_id", req.exam_id)
      .eq("item_label", req.item_label);
    if (error) return { ok: false, msg: "해설을 고치지 못했습니다: " + error.message };
  }

  const { error: uErr } = await (supabase.from("tutor_edit_requests") as any)
    .update({ status: "accepted", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", requestId);
  if (uErr) return { ok: false, msg: "요청 상태를 바꾸지 못했습니다: " + uErr.message };

  const regraded = keyChanged ? await regradeExam(createAdminClient(), req.exam_id) : 0;
  refresh(exam?.code);
  return { ok: true, regraded };
}

export async function rejectEditRequest(requestId: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const { error } = await (supabase.from("tutor_edit_requests") as any)
    .update({ status: "rejected", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, msg: "처리하지 못했습니다: " + error.message };
  refresh();
  return { ok: true };
}
