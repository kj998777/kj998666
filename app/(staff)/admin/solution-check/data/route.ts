import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { checkSolution } from "@/lib/review/solutionCheck";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";

// 풀이 점검 원자료(관리자 전용, JSON) — 화면(/admin/solution-check)과 같은 데이터를 표로 내려받거나 다른 도구로
// 살펴볼 때 쓴다(2026-10-03). 학생 정보는 들어 있지 않다(시험·문항·정답·풀이만).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const onlyFlagged = url.searchParams.get("flagged") === "1";
  const admin = createAdminClient();
  const [{ data: exams }, { data: keys }, { data: expl }, { data: subs }] = await Promise.all([
    fetchAllPages((f, t) => admin.from("exams").select("id, code, name, status").order("created_at", { ascending: false }).range(f, t)),
    fetchAllPages((f, t) => admin.from("answer_key").select("exam_id, item_label, correct_answers, type, points").order("id").range(f, t)),
    fetchAllPages((f, t) =>
      admin.from("item_explanations").select("id, exam_id, item_label, answer_display, solution, problem_statement").order("id").range(f, t)
    ),
    fetchAllPages((f, t) => admin.from("submissions").select("exam_id").order("id").range(f, t)),
  ]);
  const examById = new Map<string, any>(((exams as any[]) ?? []).map((e) => [String(e.id), e]));
  const subCount = new Map<string, number>();
  for (const s of (subs as any[]) ?? []) subCount.set(String(s.exam_id), (subCount.get(String(s.exam_id)) ?? 0) + 1);
  const explBy = new Map<string, any>(((expl as any[]) ?? []).map((x) => [`${x.exam_id}|${x.item_label}`, x]));

  const items: any[] = [];
  for (const k of (keys as any[]) ?? []) {
    const x = explBy.get(`${k.exam_id}|${k.item_label}`);
    if (!x) continue;
    const e = examById.get(String(k.exam_id));
    const check = checkSolution(k.type, String(k.correct_answers ?? ""), String(x.answer_display ?? ""), String(x.solution ?? ""));
    const displayMismatch = reconcileKeyDisplay(k.type, String(k.correct_answers ?? ""), String(x.answer_display ?? "")).mismatch;
    if (onlyFlagged && !check.flagged && !displayMismatch) continue;
    items.push({
      id: x.id,
      code: e?.code ?? "",
      name: e?.name ?? "",
      status: e?.status ?? "",
      subs: subCount.get(String(k.exam_id)) ?? 0,
      label: String(k.item_label),
      type: k.type,
      points: Number(k.points),
      key: String(k.correct_answers ?? ""),
      display: String(x.answer_display ?? ""),
      problem: String(x.problem_statement ?? ""),
      solution: String(x.solution ?? ""),
      check,
      displayMismatch,
    });
  }
  return Response.json({ count: items.length, items });
}
