"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGIC_TYPES } from "@/lib/similar/logicTypes";

// 유형 분류 탭에서 문항 하나의 논리 유형을 직접 정하기(관리자).
export async function setLogicType(itemId: string, key: string): Promise<{ ok: true } | { ok: false; msg: string }> {
  await requireRole("admin");
  if (!/^[0-9a-f-]{36}$/i.test(String(itemId))) return { ok: false, msg: "문항을 찾지 못했습니다." };
  if (!LOGIC_TYPES[key]) return { ok: false, msg: "유형표에 없는 유형입니다." };
  const { error } = await createAdminClient().from("item_explanations").update({ logic_type: key }).eq("id", itemId);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath("/admin/logic-types");
  return { ok: true };
}
