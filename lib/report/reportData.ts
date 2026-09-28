import "server-only";

// 보고서(종합/개별 PDF)용 데이터 조립 — 직원용 라우트(app/(staff)/exams/[code]/results/report-data)와
// #4 과외선생님용 라우트(app/(tutor)/tutor/store/[code]/report-data)가 함께 쓴다.
// opts.tutorId가 있으면 그 과외선생님 전용 링크로 들어온 제출(submissions.tutor_id)만 담는다.

type Client = any;

export async function buildReportData(
  supabase: Client,
  exam: { id: string; code: string; name: string },
  opts: { tutorId?: string } = {}
) {
  const [{ data: keys }, { data: explanations }, { data: subs }, { data: notes }, { data: corrections }] = await Promise.all([
    supabase.from("answer_key").select("item_label, sort_order, correct_answers, points, type").eq("exam_id", exam.id).order("sort_order").order("item_label"),
    supabase.from("item_explanations").select("*").eq("exam_id", exam.id),
    supabase
      .from("submissions")
      .select("id, class_label, student_name, submitted_at, grading_results(total_score, per_item)")
      .eq("exam_id", exam.id)
      .order("class_label")
      .order("student_name")
      .match(opts.tutorId ? { tutor_id: opts.tutorId } : {}),
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

  return body;
}
