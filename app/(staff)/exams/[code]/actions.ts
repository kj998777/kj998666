"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import type { AnswerType } from "@/lib/supabase/types";

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
  const { error } = await (supabase.from("answer_key") as any).update(fields).eq("id", id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
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
  const { error } = await (supabase.from("item_explanations") as any).update(fields).eq("id", id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
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
