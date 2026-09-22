import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import ResultRow from "./ResultRow";

type PerItem = { item_label: string; given: string; correct: boolean; points: number }[];

export default async function ResultsPage({ params }: { params: { code: string } }) {
  const session = await requireRole("viewer");
  const code = decodeURIComponent(params.code);

  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, name, code").eq("code", code).single()) as any;
  if (!exam) notFound();

  const { data: rows, error } = await supabase
    .from("submissions")
    .select("id, class_label, student_name, submitted_at, grading_results(total_score, per_item)")
    .eq("exam_id", exam.id)
    .order("class_label")
    .order("student_name");

  const submissions = (rows ?? []).map((r: any) => {
    const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
    return {
      id: r.id,
      class_label: r.class_label,
      student_name: r.student_name,
      submitted_at: r.submitted_at,
      total_score: gr?.total_score ?? 0,
      per_item: (gr?.per_item ?? []) as PerItem,
    };
  });

  const avg = submissions.length
    ? Math.round((submissions.reduce((s, r) => s + Number(r.total_score), 0) / submissions.length) * 10) / 10
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{exam.name} — 채점 결과</h1>
        <p className="text-sm text-slate-500">
          제출 {submissions.length}명 · 평균 {avg}점
        </p>
      </div>

      <div className="card">
        {error && <p className="text-sm text-red-600">불러오지 못했습니다: {error.message}</p>}
        {submissions.length === 0 ? (
          <p className="text-sm text-slate-500">아직 제출한 학생이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">반</th>
                <th className="py-2 pr-2">이름</th>
                <th className="py-2 pr-2">총점</th>
                <th className="py-2 pr-2">제출 시각</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <ResultRow key={s.id} code={code} row={s} canDelete={session.role === "admin"} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
