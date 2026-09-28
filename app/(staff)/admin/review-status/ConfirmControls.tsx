"use client";

import { useState, useTransition } from "react";
import { acceptEditRequest, confirmItem, confirmMatchedItems, keepAiAnswer, rejectEditRequest } from "./actions";

/** 문항 한 줄의 확정 컨트롤: 정답 입력칸(미리 채워짐) + 확정 버튼, 과외 답이 다르면 "AI 정답 유지"도. */
export function ConfirmItemControl({
  itemId,
  initialAnswer,
  showKeepAi,
}: {
  itemId: string;
  initialAnswer: string;
  showKeepAi: boolean;
}) {
  const [value, setValue] = useState(initialAnswer);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; msg?: string; examOpened?: boolean }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg({ ok: false, text: r.msg ?? "실패했습니다." });
      else setMsg({ ok: true, text: r.examOpened ? "확정 — 모든 문항이 확정되어 시험이 열렸습니다." : "확정했습니다." });
    });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className="input py-1 w-28 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="확정할 정답"
        />
        <button className="btn-primary py-1 px-2.5 text-sm" disabled={pending} onClick={() => run(() => confirmItem(itemId, value))}>
          {pending ? "…" : "이 정답으로 확정"}
        </button>
        {showKeepAi && (
          <button className="btn-secondary py-1 px-2.5 text-sm" disabled={pending} onClick={() => run(() => keepAiAnswer(itemId))}>
            AI 정답 유지
          </button>
        )}
      </div>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}

/** 과외선생님 답이 정답표와 같은 미확정 문항을 한 번에 확정. */
export function ConfirmMatchedButton({ examId, count }: { examId: string; count: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn-secondary py-1 px-3 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await confirmMatchedItems(examId);
            if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
            else setMsg(`${r.count ?? 0}문항 확정${r.examOpened ? " — 시험이 열렸습니다" : ""}`);
          })
        }
      >
        {pending ? "확정하는 중…" : `AI와 일치하는 ${count}문항 일괄 확정`}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </span>
  );
}

/** #4 과외선생님 수정 요청 처리: 정답표에 넣을 값(미리 채움) + 채택 / 거절. */
export function EditRequestControl({ requestId, initialAnswer }: { requestId: string; initialAnswer: string }) {
  const [value, setValue] = useState(initialAnswer);
  const [pending, start] = useTransition();
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  if (done) return <p className="text-xs text-emerald-600">{done}</p>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <input className="input py-1 w-28 text-sm" value={value} onChange={(e) => setValue(e.target.value)} aria-label="정답표에 넣을 값" />
        <button
          className="btn-primary py-1 px-2.5 text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr("");
              const r = await acceptEditRequest(requestId, value);
              if (!r.ok) setErr(r.msg ?? "실패했습니다.");
              else setDone(`반영했습니다${r.regraded ? ` — 제출 ${r.regraded}건 다시 채점` : ""}.`);
            })
          }
        >
          채택
        </button>
        <button
          className="btn-secondary py-1 px-2.5 text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr("");
              const r = await rejectEditRequest(requestId);
              if (!r.ok) setErr(r.msg ?? "실패했습니다.");
              else setDone("반영하지 않음으로 처리했습니다.");
            })
          }
        >
          거절
        </button>
      </div>
      <p className="text-xs text-slate-400">입력칸을 비워 두면 정답은 그대로 두고 해설만 반영합니다.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
