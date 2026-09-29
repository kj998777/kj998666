"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSolveItem } from "../../actions";

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
          <input id="adm-key" className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="예: 3 / 12 / 3/4 (여러 정답은 |)" />
          <p className="text-xs text-slate-400 mt-1">학생 답안 채점에 쓰는 값입니다. 객관식은 번호만(예: 3).</p>
        </div>
        <div>
          <label className="label" htmlFor="adm-display">
            정답 표시(해설용)
          </label>
          <input
            id="adm-display"
            className="input"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="비워 두면 정답표 값과 같게"
          />
          <p className="text-xs text-slate-400 mt-1">{"해설·보고서에 보이는 정답(예: ③, 12, $\\frac{3}{4}$)."}</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="adm-sol">
          풀이
        </label>
        <textarea
          id="adm-sol"
          className="input min-h-[220px] font-mono text-sm"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이를 적어 주세요. 수식은 $...$ 로 감싸면 PDF·보고서에서 수식으로 보입니다."
        />
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
