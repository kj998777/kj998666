"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUG_STATUSES } from "@/lib/bugs";

type Result = { ok: true } | { ok: false; msg: string };

/** 관리자: 버그 신고의 처리 상태·답변 저장(답변은 신고한 과외선생님 화면에 그대로 보인다). */
export async function updateBugReport(id: string, status: string, adminNote: string): Promise<Result> {
  await requireRole("admin");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, msg: "신고를 찾을 수 없습니다." };
  if (!(BUG_STATUSES as readonly string[]).includes(status)) return { ok: false, msg: "상태 값이 올바르지 않습니다." };
  const note = String(adminNote ?? "").trim().slice(0, 2000) || null;
  const admin = createAdminClient();
  const { error } = await (admin.from("bug_reports") as any)
    .update({ status, admin_note: note, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath("/admin/bug-reports");
  revalidatePath("/tutor/bugs");
  return { ok: true };
}
