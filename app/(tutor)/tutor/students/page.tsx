import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { loadTutorStudents } from "@/lib/tutor/students";

export const dynamic = "force-dynamic";

function pct(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}

// 2026-10-03 "내 학생" 탭: 선생님 전용 링크(또는 PDF 뒷면 QR)로 시험을 낸 학생을 이름별로 모아 본다.
// 이름을 누르면 그 학생이 낸 시험 목록 → 문항별 답안·풀이·개별 보고서 PDF(/tutor/students/[id]).
export default async function TutorStudentsPage({ searchParams }: { searchParams?: { q?: string } }) {
  const session = await requireTutor();
  const all = await loadTutorStudents(session.userId);
  const q = String(searchParams?.q ?? "").trim();
  const rows = q ? all.filter((r) => r.name.includes(q)) : all;

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold">내 학생</h1>
        <p className="text-sm text-slate-500">
          선생님 전용 링크(또는 다운로드한 시험지 뒷면 QR)로 시험을 낸 학생 {all.length}명입니다. 이름을 누르면 그 학생이 낸 시험마다
          문항별로 무슨 답을 냈는지, 정답·풀이, 개별 성적 보고서 PDF를 볼 수 있습니다.
        </p>
        <p className="text-xs text-slate-400">같은 이름으로 낸 제출을 한 학생으로 묶습니다. 이름을 다르게 적은 제출은 따로 보입니다.</p>
        <form className="flex gap-2" action="/tutor/students">
          <input name="q" defaultValue={q} placeholder="이름으로 찾기" className="input max-w-xs" />
          <button className="btn-secondary">찾기</button>
          {q && (
            <Link href="/tutor/students" className="self-center text-sm link-accent">
              전체 보기
            </Link>
          )}
        </form>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {q ? "찾는 이름의 학생이 없습니다." : "아직 시험을 낸 학생이 없습니다. 기출 스토어에서 시험을 받은 뒤 '제출 학생·보고서' 탭의 링크를 학생에게 보내 주세요."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">이름</th>
                  <th className="py-2 pr-2 text-right">낸 시험</th>
                  <th className="py-2 pr-2">최근 시험</th>
                  <th className="py-2 pr-2 text-right">최근 득점률</th>
                  <th className="py-2 pr-2 text-right">평균 득점률</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-100">
                    <td className="py-2 pr-2">
                      <Link href={`/tutor/students/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.nExams}개</td>
                    <td className="py-2 pr-2">
                      <div className="break-words">{r.lastExam}</div>
                      <div className="text-xs text-slate-500">{new Date(r.lastAt).toLocaleDateString("ko-KR")}</div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums font-medium">{pct(r.lastRate)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{pct(r.avgRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
