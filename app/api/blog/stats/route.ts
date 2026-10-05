import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { computeBlogStats } from "@/lib/blog/stats";

// 학원 블로그 자동 작성용 공개 집계(2026-10-01, 원장님 결정: "공개 집계만").
// 학교·시험 이름, 학생 이름·점수는 내보내지 않는다 — lib/blog/stats.ts 머리말 참고.
// 표 전체를 읽으므로 Vercel CDN에 1시간 캐시(그 뒤 하루 동안은 옛 값을 주면서 뒤에서 새로 계산).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const db = createAdminClient() as any;
    const [ex, ak, ie, gr] = await Promise.all([
      fetchAllPages((a, b) =>
        db.from("exams").select("id, school_level, folder_grade, folder_year, is_jeju, created_at, collection").order("id").range(a, b)
      ),
      fetchAllPages((a, b) => db.from("answer_key").select("id, exam_id, item_label, type, points").order("id").range(a, b)),
      fetchAllPages((a, b) =>
        db.from("item_explanations").select("id, exam_id, item_label, area, unit, difficulty").order("id").range(a, b)
      ),
      fetchAllPages((a, b) => db.from("grading_results").select("id, exam_id, per_item").order("id").range(a, b)),
    ]);
    const err = ex.error || ak.error || ie.error || gr.error;
    if (err) throw err;
    // 0051(2026-10-05): 분류(collection)가 있는 시험은 학교 기출이 아닌 학원 자체 자료(예: 부교재 변형문제)라
    // "학교 시험지 N개" 같은 블로그 숫자에 넣지 않는다.
    const schoolExams = ((ex.data as any[]) ?? []).filter((e) => !e.collection);
    const ids = new Set(schoolExams.map((e) => e.id));
    const only = (rows: any[]) => (rows ?? []).filter((r) => ids.has(r.exam_id));
    const stats = computeBlogStats(schoolExams, only(ak.data), only(ie.data), only(gr.data));
    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[blog-stats]", e);
    return NextResponse.json({ error: "통계를 읽지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
