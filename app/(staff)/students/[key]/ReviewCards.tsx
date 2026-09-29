"use client";

import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import type { Attempt } from "@/lib/students/analysis";

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };
const DIFF_CLS: Record<string, string> = {
  하: "bg-green-600",
  중하: "bg-lime-600",
  중: "bg-yellow-600",
  중상: "bg-orange-600",
  상: "bg-red-600",
};

function given(a: Attempt): string {
  if (a.blank || !a.given.trim()) return "무응답";
  return a.item.type === "객관식" && CIRC[a.given] ? CIRC[a.given] : a.given;
}
function keyPlain(a: Attempt): string {
  const raw = String(a.item.correct_answers ?? "").trim();
  const alts = raw.split("|").map((x) => x.trim()).filter(Boolean);
  return alts.map((x) => (a.item.type === "객관식" && /^[1-5]+$/.test(x) ? x.split("").map((c) => CIRC[c]).join("") : x)).join(" 또는 ") || "-";
}

// 다시 풀 문항: 약한 단원에서 틀린 것 → 쉬운데 놓친 것 순(lib/students/analysis.ts의 review)
export default function ReviewCards({ review }: { review: Attempt[] }) {
  const katex = useKatex();
  const m = (t: string) => ({ __html: renderMathHtml(katex, t) });
  if (!review.length) return null;
  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-medium">다시 풀어 볼 문항</h2>
        <p className="text-xs text-slate-500">약한 단원에서 틀린 문항, 쉬운데 놓친 문항 순으로 최대 10개 — 누적 보고서 PDF에도 같은 문항이 들어갑니다.</p>
      </div>
      <ul className="space-y-2">
        {review.map((r) => (
          <li key={r.examId + r.item.label}>
            <details className="rounded-lg border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {r.examName} · {r.item.label}번
                </span>
                <span className="text-slate-500">{r.item.unit || "단원 미상"}</span>
                <span className={"rounded-full px-2 text-[11px] font-bold text-white " + (DIFF_CLS[r.item.difficulty] ?? "bg-yellow-600")}>
                  {r.item.difficulty}
                </span>
                <span className={r.blank ? "text-amber-700" : "text-red-600"}>내 답 {given(r)}</span>
              </summary>
              <div className="mt-2 space-y-2 text-sm">
                {r.item.problem_statement ? (
                  <div className="leading-7 break-words" dangerouslySetInnerHTML={m(r.item.problem_statement)} />
                ) : (
                  <p className="text-slate-400">문제 글이 없습니다(시험지에서 확인해 주세요).</p>
                )}
                <p>
                  정답:{" "}
                  {r.item.answer_display ? (
                    <b dangerouslySetInnerHTML={m(r.item.answer_display)} />
                  ) : (
                    <b>{keyPlain(r)}</b>
                  )}
                </p>
                {r.item.solution && (
                  <div className="rounded bg-slate-50 px-3 py-2 leading-7 break-words">
                    <span className="text-xs text-slate-500">풀이</span>
                    <div dangerouslySetInnerHTML={m(r.item.solution)} />
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
