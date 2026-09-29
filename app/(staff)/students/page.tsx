import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { classDisplay, loadStudentIndex } from "@/lib/students/load";
import { encodeKey } from "@/lib/students/analysis";
import StudentList, { type ListRow } from "./StudentList";

export const dynamic = "force-dynamic";

// 학생 분석(2026-09-30): 학생 제출을 "반 + 이름"(과외 반은 "선생님 + 이름")으로 묶어 학생별 누적 성적을 본다.
export default async function StudentsPage() {
  await requireRole("viewer");
  const supabase = await createClient();
  const idx = await loadStudentIndex(supabase);
  const rows: ListRow[] = idx.entries.map((e) => ({
    id: encodeKey(e.key),
    name: e.name,
    classText: classDisplay(e, idx.tutorLabel),
    classLabel: e.classLabels[0] ?? "",
    tutor: !!e.tutorId,
    nExams: e.nExams,
    avgRate: e.avgRate,
    lastRate: e.lastRate,
    rates: e.rates,
    lastAt: e.lastAt,
    hidden: e.hidden,
    merged: e.members.length > 1,
    hasMemo: e.hasMemo,
  }));
  const monthAgo = Date.now() - 30 * 86400000;
  const active = rows.filter((r) => !r.hidden && new Date(r.lastAt).getTime() >= monthAgo).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">학생 분석</h1>
        <p className="text-sm text-slate-500">
          학생 {rows.filter((r) => !r.hidden).length}명 · 최근 30일에 시험 본 학생 {active}명. 이름을 누르면 시험별 점수 추이, 영역·단원별 정답률,
          다시 풀 문항을 보고 학부모 상담용 누적 보고서 PDF를 받을 수 있습니다.
        </p>
        <p className="text-xs text-slate-400 mt-1">
          같은 반·같은 이름으로 낸 제출을 한 학생으로 묶습니다(과외 반은 선생님별로). 학년이 올라가 반이 바뀌었거나 이름을 다르게 적었으면
          학생 화면의 &ldquo;같은 학생 합치기&rdquo;로 묶어 주세요.
        </p>
        {!idx.keysAvailable && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            학생 합치기·숨기기·상담 메모는 SQL(0039)을 실행한 뒤에 쓸 수 있습니다. 분석과 보고서는 지금도 볼 수 있어요.
          </p>
        )}
      </div>
      <StudentList rows={rows} />
    </div>
  );
}
