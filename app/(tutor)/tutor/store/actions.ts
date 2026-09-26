"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

/** 기출 PDF 구매 — 이미 구매했으면 포인트 차감 없이 그대로 통과(재다운로드는 무제한 무료). */
export async function purchaseExam(examId: string) {
  await requireTutor();
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("purchase_exam_download", { p_exam_id: examId });
  if (error) return { ok: false, msg: error.message };

  revalidatePath("/tutor/store");
  revalidatePath("/tutor/store/purchases");
  revalidatePath("/tutor/dashboard");
  return { ok: true, alreadyOwned: data.alreadyOwned, pointsSpent: data.pointsSpent };
}
