"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";

/** 관리자가 시험 상세에서 해설을 최종 확정한 뒤, 이 건을 목록에서 지운다(별도 RPC 없이 일반 update). */
export async function resolveDispute(primaryReviewId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await (supabase.from("tutor_item_reviews") as any)
    .update({ resolved: true })
    .eq("id", primaryReviewId);
  if (error) return { ok: false, msg: error.message };
  revalidatePath("/admin/tutor-disputes");
  return { ok: true };
}
