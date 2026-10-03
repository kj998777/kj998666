"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyRegradePlan, regradePlan } from "@/lib/review/regrade";

/** 제출을 지워서 그 학생이 다시 낼 수 있게 한다 — 관리자 전용(재제출 허용 목적). */
export async function deleteSubmission(code: string, submissionId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("submissions").delete().eq("id", submissionId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}/results`);
  revalidatePath("/classes/tutor");
  return { ok: true };
}

/**
 * 이 시험의 제출을 지금 정답표로 다시 채점(2026-10-03, 관리자). apply=false면 무엇이 바뀌는지만 돌려준다.
 * 정답표를 고치면 자동으로 재채점되지만, 그 전에 고친 정답표나 확인용으로 손으로 누를 수 있게.
 */
export async function regradeThisExam(code: string, apply: boolean) {
  await requireRole("admin");
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id").eq("code", code).single()) as any;
  if (!exam) return { ok: false as const, msg: "시험을 찾을 수 없습니다." };
  const admin = createAdminClient();
  const plan = await regradePlan(admin, exam.id);
  let changes = plan.changes.map((c) => ({ submission_id: c.submission_id, from: c.from, to: c.to, flipped: c.flipped, student: "" }));
  if (changes.length) {
    const { data: subs } = await admin.from("submissions").select("id, class_label, student_name").in("id", changes.map((c) => c.submission_id));
    const who = new Map<string, string>(((subs as any[]) ?? []).map((s) => [String(s.id), `${s.class_label ?? ""} ${s.student_name ?? ""}`.trim()]));
    changes = changes.map((c) => ({ ...c, student: who.get(c.submission_id) ?? "" }));
  }
  let applied = 0;
  if (apply && plan.changes.length) {
    applied = await applyRegradePlan(admin, plan);
    revalidatePath(`/exams/${code}/results`);
    revalidatePath("/students");
  }
  const msg = !plan.changes.length
    ? `제출 ${plan.checked}건을 지금 정답표로 다시 매겨 봤고, 바뀌는 것이 없습니다.`
    : apply
      ? `제출 ${applied}건을 지금 정답표로 다시 채점했습니다.`
      : `제출 ${plan.checked}건 중 ${plan.changes.length}건의 점수·정오가 지금 정답표와 다릅니다.`;
  return { ok: true as const, msg, checked: plan.checked, changes };
}
