"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPickPage } from "@/lib/similar/load";
import { canPickFor } from "@/lib/similar/pickAuth";

// 선생님이 고른 오답 유사문제 저장(0051 submissions.similar_picks). 고를 수 있는 사람인지 확인하고
// (lib/similar/pickAuth.ts), 그 제출의 후보에 있는 문항만 남겨 서비스롤로 쓴다.
export async function saveSimilarPicks(submissionId: string, picks: Record<string, string[]>): Promise<{ ok: true; n: number } | { ok: false; msg: string }> {
  const admin = createAdminClient();
  const auth = await canPickFor(admin, submissionId);
  if (!auth.ok) return { ok: false, msg: auth.msg };
  const page = await loadPickPage(admin, submissionId);
  if (!page) return { ok: false, msg: "제출을 찾지 못했습니다." };
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const g of page.groups) {
    const valid = new Set(g.candidates.map((c) => c.id));
    const ids = Array.from(new Set((Array.isArray(picks?.[g.label]) ? picks[g.label] : []).map(String))).filter((id) => valid.has(id)).slice(0, 12);
    out[g.label] = ids;
    n += ids.length;
  }
  const { error } = await admin
    .from("submissions")
    .update({ similar_picks: out, similar_picked_at: new Date().toISOString(), similar_picked_by: auth.who.userId })
    .eq("id", submissionId);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath("/students/[key]", "page");
  revalidatePath("/tutor/students/[id]", "page");
  return { ok: true, n };
}
