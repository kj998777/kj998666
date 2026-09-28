"use client";

import { useState, useTransition } from "react";
import { submitEditRequest } from "./actions";

export default function EditRequestForm({ code, itemLabel }: { code: string; itemLabel: string }) {
  const [answer, setAnswer] = useState("");
  const [solution, setSolution] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (msg?.ok) return <p className="text-sm text-emerald-600">{msg.text}</p>;

  return (
    <div className="space-y-2 pt-2">
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="text-sm text-slate-600">
          고칠 정답
          <input className="input mt-1" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={200} placeholder="바꿀 때만" />
        </label>
        <label className="text-sm text-slate-600">
          메모(이유)
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="예: 3번 선지 계산 오류" />
        </label>
      </div>
      <label className="text-sm text-slate-600 block">
        고친 해설(선택, 수식은 $…$)
        <textarea className="input mt-1 h-28" value={solution} onChange={(e) => setSolution(e.target.value)} maxLength={4000} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary py-1 px-3 text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await submitEditRequest(code, itemLabel, { answer, solution, note });
              setMsg(r.ok ? { ok: true, text: "요청을 올렸습니다. 원장님이 확인하면 반영됩니다." } : { ok: false, text: r.msg ?? "실패했습니다." });
            })
          }
        >
          {pending ? "올리는 중…" : "수정 요청 보내기"}
        </button>
        {msg && !msg.ok && <span className="text-xs text-red-600">{msg.text}</span>}
      </div>
    </div>
  );
}
