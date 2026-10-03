import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import ResultRow from "./ResultRow";
import ReportPanel from "./ReportPanel";
import RegradeButton from "./RegradeButton";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { guessSummary } from "@/lib/grading";
import GuessStatsCard from "@/app/_components/GuessStatsCard";

type PerItem = { item_label: string; given: string; correct: boolean; points: number; guessed?: boolean }[];

export default async function ResultsPage({ params }: { params: { code: string } }) {
  const session = await requireRole("viewer");
  const code = decodeURIComponent(params.code);

  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, name, code").eq("code", code).single()) as any;
  if (!exam) notFound();

  const { data: rows, error } = await supabase
    .from("submissions")
    .select("id, class_label, student_name, submitted_at, tutor_id, grading_results(total_score, per_item)")
    .eq("exam_id", exam.id)
    .order("class_label")
    .order("student_name");

  // 과외 반(과외선생님 링크 제출)은 어느 선생님 학생인지 반 칸에 함께 적는다 — "과외 (30기 홍길동)"
  const tutorIds = Array.from(new Set((rows ?? []).map((r: any) => r.tutor_id).filter(Boolean))) as string[];
  const tutorName = new Map<string, string>();
  if (tutorIds.length) {
    const { data: ts } = await (createAdminClient() as any)
      .from("profiles")
      .select("id, email, display_name, cohort")
      .in("id", tutorIds.slice(0, 150));
    for (const t of (ts ?? []) as any[]) tutorName.set(t.id, personLabel(t));
  }
  const tutorCount = (rows ?? []).filter((r: any) => r.tutor_id).length;

  const submissions = (rows ?? []).map((r: any) => {
    const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
    return {
      id: r.id,
      class_label: r.tutor_id ? `${r.class_label} (${tutorName.get(r.tutor_id) || "과외선생님"})` : r.class_label,
      student_name: r.student_name,
      submitted_at: r.submitted_at,
      total_score: gr?.total_score ?? 0,
      per_item: (gr?.per_item ?? []) as PerItem,
    };
  });

  const avg = submissions.length
    ? Math.round((submissions.reduce((s, r) => s + Number(r.total_score), 0) / submissions.length) * 10) / 10
    : 0;
  // 2026-10-01: 실질 평균(찍어서 맞힌 점수를 뺀 점수의 평균)
  const realAvg = submissions.length
    ? Math.round((submissions.reduce((s, r) => s + guessSummary(r.per_item, Number(r.total_score)).realScore, 0) / submissions.length) * 10) / 10
    : 0;
  const anyGuess = submissions.some((r) => r.per_item.some((p) => p.guessed));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{exam.name} — 채점 결과</h1>
        <p className="text-sm text-slate-500">
          제출 {submissions.length}명 · 평균 {avg}점{anyGuess ? ` · 실질 평균 ${realAvg}점` : ""}
          {tutorCount > 0 && (
            <>
              {" "}
              · 과외 반 {tutorCount}명{" "}
              <Link href={`/classes/tutor?exam=${encodeURIComponent(code)}`} className="text-brand-700 hover:underline">
                과외 반에서 보기 →
              </Link>
            </>
          )}
        </p>
      </div>

      <ReportPanel code={code} examName={exam.name} />

      {session.role === "admin" && submissions.length > 0 && <RegradeButton code={code} />}

      <GuessStatsCard perItems={submissions.map((r) => r.per_item)} />

      <div className="card">
        {error && <p className="text-sm text-red-600">불러오지 못했습니다: {error.message}</p>}
        {submissions.length === 0 ? (
          <p className="text-sm text-slate-500">아직 제출한 학생이 없습니다.</p>
        ) : (
          <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">반</th>
                <th className="py-2 pr-2">이름</th>
                <th className="py-2 pr-2">점수</th>
                <th className="py-2 pr-2" title="학생이 찍음으로 표시하고 맞힌 문항의 점수를 뺀 점수">실질 점수</th>
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
          </div>
        )}
      </div>
    </div>
  );
}
