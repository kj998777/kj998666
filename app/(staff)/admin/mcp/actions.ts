"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { revokeGrant } from "@/lib/mcp/oauth";

/** 관리자: Claude 연결 하나를 끊는다(그 연결의 access·refresh 토큰 전부 무효 — 다시 쓰려면 claude.ai에서 다시 연결). */
export async function revokeMcpGrant(formData: FormData): Promise<void> {
  await requireRole("admin");
  const grantId = String(formData.get("grant_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(grantId)) return;
  await revokeGrant(grantId);
  revalidatePath("/admin/mcp");
}
