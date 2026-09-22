"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";

/** 새 시험 생성. 처음에는 항상 "닫힘" 상태로 시작 — 정답을 등록한 뒤 관리자가 직접 열어야 한다. */
export async function createExam(formData: FormData) {
  const { userId } = await requireRole("editor");

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!code) return { ok: false, msg: "시험 코드를 입력해 주세요." };
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };

  const supabase = await createClient();
  const { error } = await supabase.from("exams").insert({ code, name, status: "닫힘", created_by: userId });
  if (error) {
    const msg = error.message.includes("duplicate") || error.code === "23505"
      ? "이미 사용 중인 시험 코드입니다."
      : "만들지 못했습니다: " + error.message;
    return { ok: false, msg };
  }

  revalidatePath("/exams");
  redirect(`/exams/${encodeURIComponent(code)}`);
}

/** 시험 자체 삭제(정답·제출·채점 결과까지 전부 함께 삭제됨) — 관리자 전용. */
export async function deleteExam(examId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("exams").delete().eq("id", examId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath("/exams");
  return { ok: true };
}
