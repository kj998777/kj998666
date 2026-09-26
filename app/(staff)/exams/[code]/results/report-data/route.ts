import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";

// 보고서 만들기(종합/개별 PDF) 기능이 브라우저에서 필요로 하는 데이터를 한 번에 내려준다.
// 옛 Apps Script 시스템(teacher-report-app.md, dg2025-report-content.md)의 보고서는 시트 값을
// 손으로 옮겨 파이썬 스크립트에 채워 넣었지만, 여기서는 answer_key/item_explanations/
// submissions+grading_results/exam_notes/exam_corrections 를 그대로 읽어 그 자리에서 재구성한다.
// 조회만 하므로 viewer 이상이면 된다(비용이 드는 AI 작업이 아님).
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("viewer");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, code, name").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  const [{ data: keys }, { data: explanations }, { data: subs }, { data: notes }, { data: corrections }] = await Promise.all([
    supabase.from("answer_key").select("item_label, sort_order, correct_answers, points, type").eq("exam_id", exam.id).order("sort_order").order("item_label"),
    supabase.from("item_explanations").select("*").eq("exam_id", exam.id),
    supabase
      .from("submissions")
      .select("id, class_label, student_name, submitted_at, grading_results(total_score, per_item)")
      .eq("exam_id", exam.id)
      .order("class_label")
      .order("student_name"),
    supabase.from("exam_notes").select("note").eq("exam_id", exam.id).order("sort_order"),
    supabase.from("exam_corrections").select("item_label, issue, fix, teacher_note").eq("exam_id", exam.id).order("item_label"),
  ]);

  const explByLabel = new Map<string, any>();
  for (const e of (explanations as any[]) ?? []) explByLabel.set(e.item_label, e);

  const items = ((keys as any[]) ?? []).map((k) => {
    const e = explByLabel.get(k.item_label) ?? {};
    return {
      label: k.item_label as string,
      points: Number(k.points),
      type: k.type as "객관식" | "주관식",
      correct_answers: k.correct_answers as string,
      area: (e.area as string) || "",
      unit: (e.unit as string) || "",
      difficulty: (e.difficulty as string) || "중",
      difficulty_reason: (e.difficulty_reason as string) || "",
      problem_statement: (e.problem_statement as string) || "",
      answer_display: (e.answer_display as string) || "",
      solution: (e.solution as string) || "",
      points_assigned: !!e.points_assigned,
      exam_error_suspected: !!e.exam_error_suspected,
    };
  });

  const students = ((subs as any[]) ?? []).map((r) => {
    const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
    return {
      id: r.id as string,
      class_label: r.class_label as string,
      student_name: r.student_name as string,
      submitted_at: r.submitted_at as string,
      total_score: Number(gr?.total_score ?? 0),
      per_item: (gr?.per_item ?? []) as { item_label: string; given: string; correct: boolean; points: number }[],
    };
  });

  const body = {
    exam: { code: exam.code, name: exam.name },
    items,
    students,
    notes: ((notes as any[]) ?? []).map((n) => n.note as string),
    corrections: ((corrections as any[]) ?? []).map((c) => ({
      item_label: c.item_label as string,
      issue: c.issue as string,
      fix: c.fix as string,
      teacher_note: c.teacher_note as string,
    })),
  };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
