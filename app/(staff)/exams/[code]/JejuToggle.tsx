"use client";

import { useState, useTransition } from "react";
import { updateExamJeju } from "../actions";

/** "제주 학교" 표시 — 검토 문항 배정 때 제주도 내 학교 문제가 타 지역 문제보다 먼저 나간다. */
export default function JejuToggle({ code, jeju }: { code: string; jeju: boolean }) {
  const [value, setValue] = useState(jeju);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <label className="flex items-center gap-1.5 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setValue(next);
          setMsg("");
          start(async () => {
            const r = await updateExamJeju(code, next);
            if (!r.ok) {
              setValue(!next);
              setMsg(r.msg ?? "실패했습니다.");
            }
          });
        }}
      />
      제주도 내 학교 시험 <span className="text-xs text-slate-400">(검토 배정 우선)</span>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </label>
  );
}
