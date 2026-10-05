"use client";

import { useEffect, useState } from "react";
import ProblemPageImage from "@/app/(tutor)/tutor/review/[itemId]/ProblemPageImage";
import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import type { SimilarCard, SimilarGroup, SimilarPage } from "@/lib/similar/load";

// 오답 유사문제 풀기(/r/[sid]). 문제는 원본 시험지에서 그 문항 부분만 잘라 보여 주고(ProblemPageImage — 과외선생님
// 검토 화면과 같은 자르기), 답을 적어 "채점"하면 정답·풀이를 보여 준다. 푼 결과는 이 기기에만 기억한다(다시 열어도 그대로).

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };
const DIFF_CLS: Record<string, string> = {
  하: "bg-white text-slate-600 ring-1 ring-slate-300",
  중하: "bg-slate-200 text-slate-800",
  중: "bg-slate-600 text-white",
  중상: "bg-brand-600 text-white",
  상: "bg-brand-800 text-white",
};
const TIER_TITLE: Record<SimilarCard["tier"], string> = {
  easier: "한 단계 쉬운 문제",
  same: "같은 난이도",
  harder: "한 단계 어려운 문제",
};
const KIND_TXT: Record<SimilarGroup["kind"], string> = { wrong: "틀림", blank: "무응답", guessed: "찍어서 맞힘" };

type Result = { checked: boolean; correct: boolean | null; answerDisplay: string; solution: string; given: string };

function Diff({ d }: { d: string }) {
  if (!d) return null;
  return <span className={"rounded-full px-2 py-0.5 text-[11px] font-bold " + (DIFF_CLS[d] ?? DIFF_CLS["중"])}>{d}</span>;
}

function storeKey(sid: string) {
  return `similar:${sid}`;
}
function loadStore(sid: string): Record<string, Result> {
  try {
    return JSON.parse(localStorage.getItem(storeKey(sid)) || "{}") || {};
  } catch {
    return {};
  }
}
function saveStore(sid: string, v: Record<string, Result>) {
  try {
    localStorage.setItem(storeKey(sid), JSON.stringify(v));
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

export default function SimilarPractice({ page }: { page: SimilarPage }) {
  const [results, setResults] = useState<Record<string, Result>>({});
  useEffect(() => setResults(loadStore(page.submissionId)), [page.submissionId]);
  const record = (id: string, r: Result | null) =>
    setResults((prev) => {
      const next = { ...prev };
      if (r) next[id] = r;
      else delete next[id];
      saveStore(page.submissionId, next);
      return next;
    });

  const all = page.groups.flatMap((g) => g.cards);
  const done = all.filter((c) => results[c.id]).length;
  const right = all.filter((c) => results[c.id]?.correct).length;

  return (
    <div className="space-y-4">
      {all.length > 0 && (
        <div className="card flex items-center justify-between gap-3 py-3">
          <div className="text-sm text-slate-600">
            유사문제 <b className="text-slate-900 tabular-nums">{all.length}</b>개 중 <b className="text-slate-900 tabular-nums">{done}</b>개 풀었어요
            {done > 0 && <span className="text-slate-500"> · 맞힘 {right}</span>}
          </div>
          <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div className="h-full rounded-full bg-slate-800" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {page.groups.map((g, gi) => (
        <GroupCard key={g.label} sid={page.submissionId} g={g} firstOpen={gi === 0} results={results} record={record} />
      ))}
    </div>
  );
}

function GroupCard({
  sid,
  g,
  firstOpen,
  results,
  record,
}: {
  sid: string;
  g: SimilarGroup;
  firstOpen: boolean;
  results: Record<string, Result>;
  record: (id: string, r: Result | null) => void;
}) {
  const [showOrig, setShowOrig] = useState(false);
  const given = g.kind === "blank" ? "무응답" : CIRC[g.given] ?? g.given;
  const tiers = (["easier", "same", "harder"] as const).map((t) => ({ t, cards: g.cards.filter((c) => c.tier === t) })).filter((x) => x.cards.length);
  return (
    <section className="card space-y-3">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{/^\d/.test(g.label) ? `${g.label}번` : g.label}</h2>
          <Diff d={g.difficulty} />
          <span className={"text-xs font-medium " + (g.kind === "guessed" ? "text-amber-700" : "text-brand-700")}>
            {KIND_TXT[g.kind]}
            {g.kind !== "blank" && ` · 내 답 ${given}`}
          </span>
        </div>
        {g.logicName ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-900">{g.logicName}</span>
            {g.logic && <p className="mt-0.5 text-slate-600 leading-relaxed">{g.logic}</p>}
          </div>
        ) : (
          g.unit && <p className="text-xs text-slate-500">{g.unit}</p>
        )}
        {g.original && (
          <div>
            <button type="button" className="text-xs text-slate-500 underline underline-offset-2" onClick={() => setShowOrig((v) => !v)}>
              {showOrig ? "원래 문제 접기" : "내가 틀린 원래 문제 다시 보기"}
            </button>
            {showOrig && (
              <div className="mt-2">
                <ProblemPageImage pdfUrl={`/api/similar/${sid}/pdf/${g.original.id}`} page={g.original.sourcePage} bbox={g.original.bbox} label={g.label} paged />
              </div>
            )}
          </div>
        )}
      </div>

      {g.cards.length === 0 ? (
        <p className="text-sm text-slate-500">
          아직 이 문항과 같은 유형의 다른 학교 문제가 준비되지 않았어요. 성적 보고서의 풀이로 먼저 복습해 주세요.
        </p>
      ) : (
        tiers.map(({ t, cards }) => (
          <div key={t} className="space-y-2">
            <p className="text-xs font-medium text-slate-500">{TIER_TITLE[t]}</p>
            {cards.map((c, ci) => (
              <ProblemCard key={c.id} sid={sid} c={c} open0={firstOpen && t === tiers[0].t && ci === 0} result={results[c.id]} record={record} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function ProblemCard({
  sid,
  c,
  open0,
  result,
  record,
}: {
  sid: string;
  c: SimilarCard;
  open0: boolean;
  result?: Result;
  record: (id: string, r: Result | null) => void;
}) {
  const katex = useKatex();
  const [open, setOpen] = useState(open0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const m = (t: string) => ({ __html: renderMathHtml(katex, t) });

  async function send(ans: string) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/similar/${encodeURIComponent(sid)}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: c.id, answer: ans }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.msg || "확인하지 못했습니다.");
      record(c.id, { checked: j.checked, correct: j.correct, answerDisplay: j.answerDisplay, solution: j.solution, given: ans });
    } catch (e: any) {
      setErr(e?.message || "네트워크 오류로 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const status = !result ? null : !result.checked ? "해설 봄" : result.correct ? "맞힘" : "틀림";
  return (
    <div className="rounded-lg border border-slate-200">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-slate-900">{c.examName}</span>
          <span className="text-slate-500"> · {/^\d/.test(c.label) ? `${c.label}번` : c.label}</span>
        </span>
        <Diff d={c.difficulty} />
        {status && (
          <span
            className={
              "text-xs font-medium " + (status === "맞힘" ? "text-emerald-700" : status === "틀림" ? "text-brand-700" : "text-slate-500")
            }
          >
            {status}
          </span>
        )}
        <span className={"text-[10px] text-slate-400 transition-transform " + (open ? "rotate-90" : "")} aria-hidden="true">
          ▶
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-3">
          <ProblemPageImage pdfUrl={`/api/similar/${sid}/pdf/${c.id}`} page={c.sourcePage} bbox={c.bbox} label={c.label} paged />

          {!result ? (
            <div className="space-y-2">
              {c.type === "객관식" ? (
                <div className="flex gap-1.5">
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={"btn-secondary flex-1 px-0 " + (answer === n ? "!bg-slate-900 !text-white" : "")}
                      onClick={() => setAnswer(n)}
                    >
                      {CIRC[n]}
                    </button>
                  ))}
                </div>
              ) : (
                <input className="input" placeholder="답을 적어 주세요 (예: 3/4, 2√3)" value={answer} maxLength={200} onChange={(e) => setAnswer(e.target.value)} />
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" disabled={busy || !answer.trim()} onClick={() => send(answer)}>
                  {busy ? "확인하는 중…" : "채점하기"}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => send("")}>
                  모르겠어요 · 풀이 보기
                </button>
              </div>
              {err && <p className="text-sm text-red-600">{err}</p>}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {result.checked && (
                <p className={"font-medium " + (result.correct ? "text-emerald-700" : "text-brand-700")}>
                  {result.correct ? "⭕ 맞았어요!" : "❌ 틀렸어요."} 내 답: {c.type === "객관식" ? CIRC[result.given] ?? result.given : result.given}
                </p>
              )}
              <p>
                정답: {result.answerDisplay ? <b dangerouslySetInnerHTML={m(result.answerDisplay)} /> : <b>-</b>}
              </p>
              {result.solution && (
                <div className="rounded-md bg-slate-50 px-3 py-2 leading-7 break-words">
                  <span className="font-medium">풀이</span>
                  <div dangerouslySetInnerHTML={m(result.solution)} />
                </div>
              )}
              {!result.correct && (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline underline-offset-2"
                  onClick={() => {
                    setAnswer("");
                    record(c.id, null);
                  }}
                >
                  다시 풀기
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
