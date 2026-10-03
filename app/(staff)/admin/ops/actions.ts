"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { backupDownloadUrl, runBackup } from "@/lib/ops/backup";
import { rejudgeJudgments } from "@/lib/ops/rejudge";
import { regradeAll, type RegradeAllReport } from "@/lib/ops/regradeAll";

// 운영 현황(/admin/ops) 화면의 버튼들 — 관리자 확인 뒤 서비스롤로 처리한다.

type Result = { ok: boolean; msg?: string; url?: string };

/** 지금 백업 */
export async function backupNow(): Promise<Result> {
  await requireRole("admin");
  const r = await runBackup(createAdminClient());
  revalidatePath("/admin/ops");
  if (!r.ok) return { ok: false, msg: r.msg };
  const errs = Object.entries(r.summary).filter(([, v]) => typeof v === "string");
  return {
    ok: true,
    msg: `백업했습니다: ${r.name}` + (errs.length ? ` (읽지 못한 표 ${errs.length}개: ${errs.map(([k]) => k).join(", ")})` : ""),
  };
}

/** 백업 파일 내려받기 링크(10분짜리) */
export async function getBackupUrl(name: string): Promise<Result> {
  await requireRole("admin");
  const url = await backupDownloadUrl(createAdminClient(), name);
  return url ? { ok: true, url } : { ok: false, msg: "내려받기 링크를 만들지 못했습니다." };
}

/** 신뢰도 초기화: 지금까지의 판정(정답률, 0037)과 불일치를 빼고 다시 센다(기록은 그대로). 수동 정지도 푼다. */
export async function resetTutorTrust(tutorId: string): Promise<Result> {
  await requireRole("admin");
  const admin = createAdminClient() as any;
  const { data: st, error } = await admin.from("tutor_stats").select("reviews_flagged").eq("tutor_id", tutorId).maybeSingle();
  if (error || !st) return { ok: false, msg: "과외선생님 정보를 찾지 못했습니다." };
  let { error: upErr } = await admin
    .from("tutor_stats")
    .update({ trust_baseline_flagged: st.reviews_flagged, review_paused: false, trust_reset_at: new Date().toISOString() })
    .eq("tutor_id", tutorId);
  if (upErr && /trust_reset_at/.test(String(upErr.message))) {
    ({ error: upErr } = await admin
      .from("tutor_stats")
      .update({ trust_baseline_flagged: st.reviews_flagged, review_paused: false })
      .eq("tutor_id", tutorId));
  }
  if (upErr) return { ok: false, msg: "바꾸지 못했습니다: " + upErr.message + " (0025 마이그레이션 확인)" };
  revalidatePath("/admin/ops");
  return { ok: true };
}

/** 검토 배정 수동 정지/재개 */
export async function setTutorPaused(tutorId: string, paused: boolean): Promise<Result> {
  await requireRole("admin");
  const admin = createAdminClient() as any;
  const { error } = await admin.from("tutor_stats").update({ review_paused: paused }).eq("tutor_id", tutorId);
  if (error) return { ok: false, msg: "바꾸지 못했습니다: " + error.message + " (0025 마이그레이션 확인)" };
  revalidatePath("/admin/ops");
  return { ok: true };
}

/**
 * 정답률 기록 다시 맞추기(2026-09-30): 객관식 답 모양("④"·"4번") 차이로 "틀림"이 된 기록을 지금 비교 방법으로 다시 본다.
 * apply=false면 몇 건이 바뀌는지만 알려 준다.
 */
export async function rejudgeNow(apply: boolean): Promise<Result & { flips?: number; tutors?: number; checked?: number }> {
  await requireRole("admin");
  const r = await rejudgeJudgments(createAdminClient(), apply);
  if (!r.ok || !r.plan) return { ok: false, msg: r.msg ?? "실패했습니다." };
  const flips = r.plan.flips.length;
  const tutors = Object.keys(r.plan.byTutor).length;
  if (apply) revalidatePath("/admin/ops");
  const tail = r.plan.skippedUnconfirmed ? ` (정답이 아직 확정 전이라 그대로 둔 ${r.plan.skippedUnconfirmed}건)` : "";
  return {
    ok: true,
    flips,
    tutors,
    checked: r.plan.checked,
    msg: !flips
      ? `"틀림" 기록 ${r.plan.checked}건을 살펴봤고 고칠 것이 없습니다.` + tail
      : apply
        ? `${tutors}명의 기록 ${flips}건을 "맞음"으로 고쳤습니다. 정답률·등급에 바로 반영됩니다.` + tail
        : `"틀림" 기록 ${r.plan.checked}건 중 ${flips}건(${tutors}명)이 사실은 맞은 답입니다.` + tail,
  };
}

/**
 * 전체 재채점(2026-10-03): 채점 결과가 있는 모든 시험을 지금 정답표로 다시 매긴다. apply=false면 무엇이 바뀌는지만.
 * 정답표를 고쳐도 기존 채점이 그대로이던(PR #57 전) 결과를 바로잡는 용도. 여러 번 눌러도 안전.
 */
export async function regradeAllNow(apply: boolean): Promise<Result & { report?: RegradeAllReport }> {
  await requireRole("admin");
  try {
    const report = await regradeAll(createAdminClient(), apply);
    if (apply && report.applied > 0) {
      revalidatePath("/admin/ops");
      revalidatePath("/students");
      for (const e of report.exams) {
        revalidatePath(`/exams/${e.code}/results`);
        revalidatePath(`/exams/${e.code}`);
      }
    }
    const msg = !report.changed
      ? `채점 결과 ${report.checked}건을 지금 정답표로 다시 매겨 봤고, 바뀌는 것이 없습니다.`
      : apply
        ? `${report.exams.length}개 시험의 채점 결과 ${report.applied}건을 지금 정답표로 다시 매겼습니다.`
        : `채점 결과 ${report.checked}건 중 ${report.changed}건(${report.exams.length}개 시험)의 점수·정오가 지금 정답표와 다릅니다.`;
    return { ok: true, msg, report };
  } catch (e: any) {
    return { ok: false, msg: "재채점에 실패했습니다: " + (e?.message ?? String(e)) };
  }
}
