import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PlacementTest } from "@/lib/placement/server";

// 볼 수 있는 입학테스트 목록과 테스트별 제출 수(RLS가 거른다 — 0047)
export async function listVisibleTests(f: { ownerId?: string; kind?: "staff" | "tutor" } = {}): Promise<{ tests: PlacementTest[]; counts: Record<string, number> }> {
  const supabase = await createClient();
  let q = (supabase.from("placement_tests") as any).select("*").order("created_at", { ascending: false }).limit(50);
  if (f.ownerId) q = q.eq("owner_id", f.ownerId);
  if (f.kind) q = q.eq("owner_kind", f.kind);
  const { data } = (await q) as any;
  const tests = ((data as any[]) ?? []) as PlacementTest[];
  const counts: Record<string, number> = {};
  if (tests.length) {
    const { data: subs } = (await (supabase.from("placement_submissions") as any)
      .select("test_id")
      .in("test_id", tests.map((t) => t.id))
      .limit(5000)) as any;
    for (const s of (subs as any[]) ?? []) counts[s.test_id] = (counts[s.test_id] ?? 0) + 1;
  }
  return { tests, counts };
}
