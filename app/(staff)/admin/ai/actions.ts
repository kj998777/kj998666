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
