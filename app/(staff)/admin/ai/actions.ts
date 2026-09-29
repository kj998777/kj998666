"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import {
  clearAiKey,
  clearBalance,
  clearLowBalanceAlert,
  getAiSettingsPublic,
  getCreditInfo,
  saveAiSettings,
  saveBalance,
} from "@/lib/ai/settings";

export async function loadAiSettings() {
  await requireRole("admin");
  const supabase = await createClient();
  return getAiSettingsPublic(supabase);
}

export async function loadCreditInfo() {
  await requireRole("admin");
  const supabase = await createClient();
  return getCreditInfo(supabase);
}

export async function saveAiSettingsAction(formData: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  const key = String(formData.get("api_key") ?? "");
  const model = String(formData.get("model") ?? "");
  const r = await saveAiSettings(supabase, key, model);
  revalidatePath("/admin/ai");
  return r;
}

export async function clearAiKeyAction() {
  await requireRole("admin");
  const supabase = await createClient();
  const settings = await clearAiKey(supabase);
  revalidatePath("/admin/ai");
  return { ok: true as const, settings };
}

export async function saveBalanceAction(formData: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  const r = await saveBalance(supabase, String(formData.get("balance") ?? ""));
  revalidatePath("/admin/ai");
  return r;
}

export async function clearBalanceAction() {
  await requireRole("admin");
  const supabase = await createClient();
  await clearBalance(supabase);
  revalidatePath("/admin/ai");
  return { ok: true as const };
}

export async function clearLowAlertAction() {
  await requireRole("admin");
  const supabase = await createClient();
  await clearLowBalanceAlert(supabase);
  revalidatePath("/admin/ai");
  return { ok: true as const };
}

/** 2026-09-29: PDF가 있는데 원본 속 QR을 아직 안 찾은(또는 PDF가 바뀐·오류 난) 시험을 모두 찾게 건다. */
export async function enqueueAllQrScansAction(): Promise<{ ok: boolean; msg: string }> {
  await requireRole("admin");
  const { enqueueAllQrScans } = await import("@/lib/ai/qrMask");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const n = await enqueueAllQrScans(createAdminClient());
  revalidatePath("/admin/ai");
  return {
    ok: true,
    msg: n ? `${n}개 시험의 QR 찾기를 걸었습니다. 몇 분마다 조금씩 처리됩니다.` : "새로 찾을 시험이 없습니다(또는 마이그레이션 0031 전).",
  };
}
