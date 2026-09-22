"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import type { AnswerType } from "@/lib/supabase/types";

async function getExamId(code: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("exams").select("id, status").eq("code", code).single();
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
    .insert({ exam_id: exam.id, item_label, correct_answers, points, type, sort_order });

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
  const { error } = await supabase.from("answer_key").update(fields).eq("id", id);
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

  const { error } = await supabase
    .from("exams")
    .update({ status: open ? "열림" : "닫힘" })
    .eq("code", code);

  if (error) return { ok: false, msg: "바꾸지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  revalidatePath("/exams");
  return { ok: true };
}
