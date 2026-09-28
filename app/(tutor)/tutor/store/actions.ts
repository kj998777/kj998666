"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** 기출 PDF 구매 — 이미 구매했으면 포인트 차감 없이 그대로 통과(재다운로드는 무제한 무료). */
export async function purchaseExam(examId: string) {
  await requireTutor();
  // 원본 PDF가 없는 시험은 사도 받을 게 없으므로 포인트를 쓰기 전에 막는다.
  const { data: meta } = await (createAdminClient() as any).from("exam_pdf_meta").select("exam_id").eq("exam_id", examId).maybeSingle();
  if (!meta) return { ok: false, msg: "이 시험은 아직 PDF가 준비되지 않았습니다." };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("purchase_exam_download", { p_exam_id: examId });
  if (error) return { ok: false, msg: error.message };

  revalidatePath("/tutor/store");
  revalidatePath("/tutor/store/purchases");
  revalidatePath("/tutor/dashboard");
  return { ok: true, alreadyOwned: data.alreadyOwned, pointsSpent: data.pointsSpent };
}
