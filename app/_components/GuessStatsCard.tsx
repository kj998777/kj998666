import { guessStatsByItem, guessTotals, manyGuessed, pctOf } from "@/lib/report/guessStats";

// 2026-10-01 찍음 통계: 채점 결과 화면(학원·과외)에 반 전체 찍음 표시 요약과 "찍은 학생이 많은 문항"을 보여 준다.
// 찍음 표시가 하나도 없으면 아무것도 그리지 않는다.
type P = { item_label: string; correct?: boolean; guessed?: boolean };

export default function GuessStatsCard({ perItems }: { perItems: P[][] }) {
  const tot = guessTotals(perItems);
  if (!tot.marks) return null;
  const stats = guessStatsByItem(perItems).filter((s) => s.guessed > 0);
  const many = new Set(manyGuessed(stats).map((s) => s.label));
  const top = [...stats].sort((a, b) => b.guessed - a.guessed || a.label.localeCompare(b.label, "ko", { numeric: true })).slice(0, 8);
  return (
    <div className="card space-y-2">
      <h2 className="font-medium">찍음 통계</h2>
      <p className="text-sm text-slate-600">
        {tot.students}명 중 <b>{tot.studentsGuessed}명</b>이 모두 <b>{tot.marks}문항</b>에 &ldquo;찍음&rdquo;을 표시했고, 그중{" "}
        <b>
          {tot.marksCorrect}문항({pctOf(tot.marksCorrect, tot.marks)}%)
        </b>
        을 맞혔습니다.
      </p>
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-2">문항</th>
              <th className="py-1.5 pr-2">찍은 학생</th>
              <th className="py-1.5 pr-2">그중 맞힘</th>
              <th className="py-1.5 pr-2" title="찍어서 맞힌 학생을 뺀 정답 인원">확실히 맞힘</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s) => (
              <tr key={s.label} className={"border-b border-slate-100 " + (many.has(s.label) ? "bg-amber-50" : "")}>
                <td className="py-1.5 pr-2 font-medium">{s.label}번</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {s.guessed}/{s.n}명 <span className="text-xs text-slate-400">({pctOf(s.guessed, s.n)}%)</span>
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{s.guessedCorrect}명</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {s.realCorrect}/{s.n}명
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        노란 줄은 응시자의 30% 이상(2명 이상)이 찍은 문항입니다. 맞혔더라도 확신이 없었던 문항이라 수업에서 다시 짚어 주면 좋아요. 종합 보고서 PDF에도
        같은 내용이 들어갑니다.
      </p>
    </div>
  );
}
