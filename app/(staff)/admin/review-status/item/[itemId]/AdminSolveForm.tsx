"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSolveItem } from "../../actions";
import { MathPreview, MathToolbar } from "@/app/_components/MathTools";
import { latexToPlain } from "@/lib/grading";

export default function AdminSolveForm({
  itemId,
  initialKey,
  initialDisplay,
  initialSolution,
  nextHref,
}: {
  itemId: string;
  initialKey: string;
  initialDisplay: string;
  initialSolution: string;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [key, setKey] = useState(initialKey);
  const [display, setDisplay] = useState(initialDisplay);
  const [solution, setSolution] = useState(initialSolution);
  const keyRef = useRef<HTMLInputElement | null>(null);
  const displayRef = useRef<HTMLInputElement | null>(null);
  const solutionRef = useRef<HTMLTextAreaElement | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (goNext: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await adminSolveItem(itemId, { key, display, solution });
      if (!r.ok) {
        setMsg({ ok: false, text: r.msg ?? "저장하지 못했습니다." });
        return;
      }
      const extra = [r.regraded ? `제출 ${r.regraded}건 다시 채점` : "", r.examOpened ? "모든 문항이 확정되어 시험이 열렸습니다" : ""]
        .filter(Boolean)
        .join(" · ");
      setMsg({ ok: true, text: "저장하고 확정했습니다." + (extra ? ` (${extra})` : "") });
      if (goNext && nextHref) router.push(nextHref);
      else router.refresh();
    });

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">정답·해설 직접 등록</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="adm-key">
            정답표(채점용)
          </label>
          <input id="adm-key" ref={keyRef} className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="예: 3 / 12 / 3/4 (여러 정답은 |)" />
          <p className="text-xs text-slate-400 mt-1">학생 답안 채점에 쓰는 값입니다. 객관식은 번호만(예: 3). 분수·루트는 아래 버튼으로 적어도 됩니다.</p>
          <MathToolbar target={keyRef} value={key} onChange={setKey} circled />
          {/[$\\]/.test(key) && (
            <p className="text-xs text-slate-600 mt-1">
              정답표에 저장될 모양: <b className="font-mono">{latexToPlain(key) || "—"}</b>
              <span className="text-slate-400"> (학생이 3/4·0.75·6/8 등으로 적어도 같은 값이면 정답)</span>
            </p>
          )}
          <MathPreview text={key} className="mt-1" />
        </div>
        <div>
          <label className="label" htmlFor="adm-display">
            정답 표시(해설용)
          </label>
          <input
            id="adm-display"
            ref={displayRef}
            className="input"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="비워 두면 정답표 값과 같게"
          />
          <p className="text-xs text-slate-400 mt-1">{"해설·보고서에 보이는 정답(예: ③, 12, $\\frac{3}{4}$)."}</p>
          <MathToolbar target={displayRef} value={display} onChange={setDisplay} circled />
          <MathPreview text={display} className="mt-1" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="adm-sol">
          풀이
        </label>
        <MathToolbar target={solutionRef} value={solution} onChange={setSolution} />
        <textarea
          id="adm-sol"
          ref={solutionRef}
          className="input min-h-[220px] font-mono text-sm mt-1"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이를 적어 주세요. 위 버튼으로 분수·루트·경우 나누기 같은 수식을 넣을 수 있고, 수식은 $...$ 로 감싸면 PDF·보고서에서 수식으로 보입니다."
        />
        <MathPreview text={solution} className="mt-2" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending} onClick={() => save(false)}>
          {pending ? "저장하는 중…" : "저장하고 확정"}
        </button>
        {nextHref && (
          <button className="btn-secondary" disabled={pending} onClick={() => save(true)}>
            저장하고 다음 문항
          </button>
        )}
      </div>
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
