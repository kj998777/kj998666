import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import ResultRow from "@/app/(staff)/exams/[code]/results/ResultRow";
import CopyLink from "./CopyLink";

type PerItem = { item_label: string; given: string; correct: boolean; points: number }[];

// #109: 구매한 시험은 과외선생님도 제출 링크(/s/[code])를 본인 학생들에게 나눠주고 제출 현황을
// 볼 수 있어야 한다. 직원용 결과 화면(app/(staff)/exams/[code]/results/page.tsx)과 거의 같은
// 모양이지만:
//   (a) requireTutor() + tutor_exam_purchases 소유 확인을 페이지에서도 한 번 더 한다(RLS 하나만
//       믿지 않는 이 코드베이스의 다른 화면들과 같은 "방어 이중화" 패턴).
//   (b) ResultRow의 삭제 버튼(canDelete)은 항상 false — 과외선생님은 학교 시험 데이터를 지울 수 없다.
//   (c) 직원 전용 ReportPanel(종합/개별 PDF, requireApiRole("viewer")로 막혀 있음)은 넣지 않는다 —
//       과외선생님용 보고서가 필요해지면 그때 별도로 열어준다.
export default async function TutorExamResultsPage({ params }: { params: { code: string } }) {
  const session = await requireTutor();
  const code = decodeURIComponent(params.code);
  const supabase = await createClient();

  const { data: exam } = (await supabase
    .from("exams")
    .select("id, name, code")
    .eq("code", code)
    .maybeSingle()) as any;
  if (!exam) notFound();

  const { data: purchase } = (await supabase
    .from("tutor_exam_purchases")
    .select("id")
    .eq("exam_id", exam.id)
    .eq("tutor_id", session.userId)
    .maybeSingle()) as any;
  if (!purchase) notFound();

  const submitPath = `/s/${encodeURIComponent(exam.code)}`;

  const { data: rows, error } = await supabase
    .from("submissions")
    .select("id, class_label, student_name, submitted_at, grading_results(total_score, per_item)")
    .eq("exam_id", exam.id)
    .order("class_label")
    .order("student_name");

  const submissions = ((rows as any[]) ?? []).map((r: any) => {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{exam.name} — 제출 현황</h1>
          <p className="text-sm text-slate-500">
            제출 {submissions.length}명 · 평균 {avg}점
          </p>
        </div>
        <Link href="/tutor/store/purchases" className="text-sm link-accent whitespace-nowrap">
          ← 구매 내역으로
        </Link>
      </div>

      <div className="card">
        <p className="text-sm text-slate-500 mb-2">
          아래 링크를 학생들에게 나눠주면 여기서 바로 답을 제출할 수 있습니다. 반을 목록에서 아무거나
          골라도 제출·채점에는 문제없습니다.
        </p>
        <CopyLink path={submitPath} />
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
                <ResultRow key={s.id} code={code} row={s} canDelete={false} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
