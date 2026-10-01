import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages, fetchAllIn } from "@/lib/supabase/fetchAll";
import { personLabel } from "@/lib/profile/label";
import TutorSubmissionRow from "./TutorSubmissionRow";
import { guessSummary } from "@/lib/grading";

// 2026-09-29 원장님 요청: 과외선생님 전용 QR·링크로 들어온 학생 제출을 모두 "과외" 반으로 모아 한곳에서 보고 관리한다.
// 시험별로 묶고, 과외선생님·시험으로 걸러 볼 수 있다. 삭제(재제출 허용)는 관리자만.
// 조회는 직원 확인(requireRole) 뒤 서비스롤로 한다 — 과외선생님 이름(profiles)까지 한 번에 읽기 위해서.
export const dynamic = "force-dynamic";

type Sub = {
  id: string;
  exam_id: string;
  student_name: string;
  submitted_at: string;
  tutor_id: string;
  total_score: number;
  real_score: number;
};

export default async function TutorClassPage({ searchParams }: { searchParams: { tutor?: string; exam?: string } }) {
  const session = await requireRole("viewer");
  const admin = createAdminClient() as any;
  const tutorFilter = typeof searchParams?.tutor === "string" ? searchParams.tutor : "";
  const examFilter = typeof searchParams?.exam === "string" ? searchParams.exam : "";

  const { data: rows, error } = await fetchAllPages((from, to) =>
    admin
      .from("submissions")
      .select("id, exam_id, student_name, submitted_at, tutor_id, grading_results(total_score, per_item)")
      .not("tutor_id", "is", null)
      .order("submitted_at", { ascending: false })
      .order("id")
      .range(from, to)
  );

  const all: Sub[] = (rows ?? []).map((r: any) => {
    const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
    return {
      id: r.id,
      exam_id: r.exam_id,
      student_name: r.student_name,
      submitted_at: r.submitted_at,
      tutor_id: r.tutor_id,
      total_score: Number(gr?.total_score ?? 0),
      real_score: guessSummary(gr?.per_item ?? [], Number(gr?.total_score ?? 0)).realScore,
    };
  });

  const examIds = Array.from(new Set(all.map((s) => s.exam_id)));
  const tutorIds = Array.from(new Set(all.map((s) => s.tutor_id)));
  const [{ data: exams }, { data: tutors }] = await Promise.all([
    fetchAllIn(examIds, (chunk, from, to) =>
      admin.from("exams").select("id, code, name").in("id", chunk).order("id").range(from, to)
    ),
    fetchAllIn(tutorIds, (chunk, from, to) =>
      admin.from("profiles").select("id, email, display_name, cohort").in("id", chunk).order("id").range(from, to)
    ),
  ]);
  const examById = new Map<string, { code: string; name: string }>((exams ?? []).map((e: any) => [e.id, e]));
  const tutorName = new Map<string, string>((tutors ?? []).map((t: any) => [t.id, personLabel(t) || "(이름 없음)"]));

  const shown = all.filter(
    (s) => (!tutorFilter || s.tutor_id === tutorFilter) && (!examFilter || examById.get(s.exam_id)?.code === examFilter)
  );

  // 시험별로 묶기(가장 최근 제출이 있는 시험부터)
  const groups = new Map<string, Sub[]>();
  for (const s of shown) {
    if (!groups.has(s.exam_id)) groups.set(s.exam_id, []);
    groups.get(s.exam_id)!.push(s);
  }

  // 선생님별 요약(필터 버튼)
  const perTutor = new Map<string, number>();
  for (const s of all) perTutor.set(s.tutor_id, (perTutor.get(s.tutor_id) ?? 0) + 1);
  const tutorChips = Array.from(perTutor.entries()).sort((a, b) => b[1] - a[1]);

  const qs = (t: string, e: string) => {
    const p = new URLSearchParams();
    if (t) p.set("tutor", t);
    if (e) p.set("exam", e);
    const s = p.toString();
    return `/classes/tutor${s ? `?${s}` : ""}`;
  };
  const examFilterName = examFilter ? Array.from(examById.values()).find((e) => e.code === examFilter)?.name : null;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/classes" className="text-sm text-slate-500 hover:underline">
          ← 반 관리
        </Link>
        <h1 className="text-lg font-semibold mt-1">과외 반</h1>
        <p className="text-sm text-slate-500">
          과외선생님 전용 QR·링크로 제출한 학생은 모두 이 &ldquo;과외&rdquo; 반으로 모입니다. 제출 {all.length}건 · 선생님{" "}
          {perTutor.size}명 · 시험 {examIds.length}개
        </p>
      </div>

      {error && <p className="text-sm text-red-600">불러오지 못했습니다: {String(error.message ?? error)}</p>}

      {tutorChips.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-medium">과외선생님별로 보기</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href={qs("", examFilter)}
              className={
                "rounded-full border px-3 py-1 text-sm " +
                (!tutorFilter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700")
              }
            >
              전체 {all.length}
            </Link>
            {tutorChips.map(([id, n]) => (
              <Link
                key={id}
                href={qs(id, examFilter)}
                className={
                  "rounded-full border px-3 py-1 text-sm " +
                  (tutorFilter === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700")
                }
              >
                {tutorName.get(id) ?? "(알 수 없음)"} {n}
              </Link>
            ))}
          </div>
          {examFilterName && (
            <p className="text-xs text-slate-500">
              시험 &ldquo;{examFilterName}&rdquo;만 보는 중 ·{" "}
              <Link href={qs(tutorFilter, "")} className="underline">
                모든 시험 보기
              </Link>
            </p>
          )}
        </div>
      )}

      {groups.size === 0 ? (
        <div className="card">
          <p className="text-sm text-slate-500">
            {all.length === 0 ? "아직 과외선생님 링크로 들어온 제출이 없습니다." : "조건에 맞는 제출이 없습니다."}
          </p>
        </div>
      ) : (
        Array.from(groups.entries()).map(([examId, subs]) => {
          const ex = examById.get(examId);
          const avg = Math.round((subs.reduce((a, s) => a + s.total_score, 0) / subs.length) * 10) / 10;
          return (
            <div key={examId} className="card space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">{ex?.name ?? "(삭제된 시험)"}</h2>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-slate-500">
                    {subs.length}명 · 평균 {avg}점
                  </span>
                  {ex && (
                    <Link href={`/exams/${encodeURIComponent(ex.code)}/results`} className="text-brand-700 hover:underline">
                      채점 결과·보고서 →
                    </Link>
                  )}
                </div>
              </div>
              <div className="table-wrap">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-2">과외선생님</th>
                      <th className="py-2 pr-2">학생</th>
                      <th className="py-2 pr-2">점수</th>
                      <th className="py-2 pr-2" title="찍어서 맞힌 점수를 뺀 점수">실질 점수</th>
                      <th className="py-2 pr-2">제출 시각</th>
                      <th className="py-2 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <TutorSubmissionRow
                        key={s.id}
                        code={ex?.code ?? ""}
                        row={{
                          id: s.id,
                          tutor: tutorName.get(s.tutor_id) ?? "(알 수 없음)",
                          student_name: s.student_name,
                          total_score: s.total_score,
                          real_score: s.real_score,
                          submitted_at: s.submitted_at,
                        }}
                        canDelete={session.role === "admin" && !!ex}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
