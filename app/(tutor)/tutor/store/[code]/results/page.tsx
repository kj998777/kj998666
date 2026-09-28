import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { getPurchasedExam } from "@/lib/tutor/purchased";
import { ensureTutorLinkToken, tutorSubmitPath } from "@/lib/tutor/link";
import ResultRow from "@/app/(staff)/exams/[code]/results/ResultRow";
import ReportPanel from "@/app/(staff)/exams/[code]/results/ReportPanel";
import TutorExamTabs from "../TutorExamTabs";
import CopyLink from "./CopyLink";

export const dynamic = "force-dynamic";

type PerItem = { item_label: string; given: string; correct: boolean; points: number }[];

// #109 → #4 (2026-09-28): 구매한 시험의 "제출 학생·보고서" 탭.
//   - 원장님 결정으로, 과외선생님 본인 전용 링크(/s/코드?t=토큰)로 제출한 학생만 보인다(학원 학생 제출은
//     안 보임). RLS(0017 submissions_select_tutor_own)도 같은 조건이고, 여기서도 tutor_id로 한 번 더 거른다.
//   - ResultRow의 삭제 버튼(canDelete)은 항상 false.
//   - 보고서(종합/개별 PDF)는 직원용 ReportPanel을 그대로 쓰되, 데이터는 과외선생님 전용 경로에서 받는다.
export default async function TutorExamResultsPage({ params }: { params: { code: string } }) {
  const session = await requireTutor();
  const code = decodeURIComponent(params.code);
  const exam = await getPurchasedExam(session.userId, code);
  if (!exam) notFound();

  let submitPath: string | null = null;
  try {
    submitPath = tutorSubmitPath(exam.code, await ensureTutorLinkToken(session.userId));
  } catch {
    submitPath = null;
  }

  const supabase = await createClient();
  const { data: rows, error } = await (supabase.from("submissions") as any)
    .select("id, class_label, student_name, submitted_at, grading_results(total_score, per_item)")
    .eq("exam_id", exam.id)
    .eq("tutor_id", session.userId)
    .order("submitted_at", { ascending: false });

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
      <TutorExamTabs code={exam.code} name={exam.name} active="results" />

      <div className="card space-y-2">
        <p className="text-sm text-slate-600">
          제출 {submissions.length}명 · 평균 {avg}점
        </p>
        <p className="text-sm text-slate-500">
          선생님 전용 링크(또는 다운로드한 PDF 뒷면 QR)로 제출한 학생만 여기에 보입니다.
        </p>
        {submitPath && <CopyLink path={submitPath} />}
      </div>

      {submissions.length > 0 && <ReportPanel code={exam.code} examName={exam.name} dataUrl={`/tutor/store/${encodeURIComponent(exam.code)}/report-data`} />}

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
