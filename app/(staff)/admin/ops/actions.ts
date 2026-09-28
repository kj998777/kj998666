"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { backupDownloadUrl, runBackup } from "@/lib/ops/backup";

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

/** 신뢰도 초기화: 지금까지의 불일치를 기준점으로 잡아 0부터 다시 센다(기록은 그대로). 수동 정지도 푼다. */
export async function resetTutorTrust(tutorId: string): Promise<Result> {
  await requireRole("admin");
  const admin = createAdminClient() as any;
  const { data: st, error } = await admin.from("tutor_stats").select("reviews_flagged").eq("tutor_id", tutorId).maybeSingle();
  if (error || !st) return { ok: false, msg: "과외선생님 정보를 찾지 못했습니다." };
  const { error: upErr } = await admin
    .from("tutor_stats")
    .update({ trust_baseline_flagged: st.reviews_flagged, review_paused: false })
    .eq("tutor_id", tutorId);
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
