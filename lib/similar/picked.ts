import "server-only";
import { fetchAllIn } from "@/lib/supabase/fetchAll";
import { cleanPicks } from "@/lib/similar/load";

/** 제출들의 "선생님이 고른 오답 유사문제 수"(null = 아직 안 고름). 0051 전이면 빈 객체(버튼은 "아직 안 고름"). */
export async function loadPickedCounts(admin: any, submissionIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!submissionIds.length) return out;
  const { data, error } = await fetchAllIn(submissionIds, (ids, a, b) =>
    admin.from("submissions").select("id, similar_picks").in("id", ids).order("id").range(a, b)
  );
  if (error) return out;
  for (const r of (data as any[]) ?? []) {
    const p = cleanPicks(r.similar_picks);
    out[r.id] = p ? Object.values(p).reduce<number>((a, b) => a + b.length, 0) : null;
  }
  return out;
}
