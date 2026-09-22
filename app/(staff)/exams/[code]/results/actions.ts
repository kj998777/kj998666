"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";

/** 제출을 지워서 그 학생이 다시 낼 수 있게 한다 — 관리자 전용(재제출 허용 목적). */
export async function deleteSubmission(code: string, submissionId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("submissions").delete().eq("id", submissionId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}/results`);
  return { ok: true };
}
