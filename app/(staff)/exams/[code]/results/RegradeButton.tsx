"use client";

import { useState, useTransition } from "react";
import { regradeThisExam } from "./actions";

// 이 시험 재채점(2026-10-03, 관리자) — "무엇이 바뀌는지 보기" → "다시 채점하기" 두 단계. 운영 현황의 전체 재채점과 같은 모양.
type Change = { student: string; from: number; to: number; flipped: string[] };

export default function RegradeButton({ code }: { code: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const run = (apply: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await regradeThisExam(code, apply);
      setMsg({ ok: r.ok, text: r.msg });
      setChanges(r.ok ? r.changes : null);
      setPreviewed(r.ok && !apply && r.changes.length > 0);
    });
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-sm">지금 정답표로 다시 채점</h2>
          <p className="text-xs text-slate-500">정답표를 고치면 자동으로 되지만, 확인하고 싶을 때 손으로도 누를 수 있습니다. 여러 번 눌러도 안전합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary py-1 px-3 text-sm" disabled={pending} onClick={() => run(false)}>
            {pending && !previewed ? "살펴보는 중…" : "무엇이 바뀌는지 보기"}
          </button>
          {previewed && (
            <button type="button" className="btn-primary py-1 px-3 text-sm" disabled={pending} onClick={() => run(true)}>
              {pending ? "다시 채점하는 중…" : `${changes?.length ?? 0}건 다시 채점하기`}
            </button>
          )}
        </div>
      </div>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
      {changes && changes.length > 0 && (
        <ul className="text-xs text-slate-700 space-y-0.5">
          {changes.map((c, i) => (
            <li key={i}>
              {c.student || "(이름 없음)"}: {fmt(c.from)}점 → <b>{fmt(c.to)}점</b>
              {c.flipped.length ? ` (정오 바뀐 문항: ${c.flipped.join(", ")})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
