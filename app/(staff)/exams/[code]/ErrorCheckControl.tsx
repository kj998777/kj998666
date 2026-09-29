"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelErrorCheckAction,
  discardErrorCheckAction,
  setErrorFlagAction,
  startErrorCheckAction,
  type ErrorCheckPoll,
} from "./error-actions";
import { pollJob } from "@/lib/jobPoll";

const ACTIVE = new Set(["rx_submit", "rx_wait"]);

export default function ErrorCheckControl({
  code,
  label,
  suspected,
  initialCheck,
}: {
  code: string;
  label: string;
  suspected: boolean;
  initialCheck: ErrorCheckPoll;
}) {
  const router = useRouter();
  const [check, setCheck] = useState<ErrorCheckPoll>(initialCheck);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    function stop() {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
    // 2026-09-29 최적화: fetch로 확인(화면 이동을 막지 않음), 앞선 확인이 끝나기 전에는 새로 부르지 않음
    if (check && ACTIVE.has(check.stage)) {
      timer.current = setInterval(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          const res = await pollJob<ErrorCheckPoll>(code, "errcheck", label);
          if (!res.ok) return;
          const r = res.data;
          setCheck(r);
          if (r && (r.stage === "rx_done" || r.stage === "rx_error")) router.refresh();
        } finally {
          busy.current = false;
        }
      }, 5000);
    } else {
      stop();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check?.stage, code, label]);

  const active = check ? ACTIVE.has(check.stage) : false;

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      {!open && !active && !check && (
        <button className="text-xs text-orange-600 hover:underline" onClick={() => setOpen(true)}>
          🚩 출제오류 의심
        </button>
      )}

      {open && !active && (
        <div className="space-y-2">
          <textarea
            className="input text-xs w-full"
            rows={2}
            maxLength={300}
            placeholder="의심되는 점(선택, 300자 이내) — 예: 조건이 서로 모순되는 것 같습니다"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary text-xs px-2 py-1"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg("");
                  const r = await startErrorCheckAction(code, label, hint);
                  if (!r.ok) setMsg(r.msg);
                  else {
                    setOpen(false);
                    setCheck({ stage: "rx_submit", message: "출제오류 의심 여부를 AI가 확인하는 중…", updatedAt: new Date().toISOString() });
                  }
                })
              }
            >
              AI가 살펴보기
            </button>
            <button
              className="btn-secondary text-xs px-2 py-1"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg("");
                  const r = await setErrorFlagAction(code, label, true, hint);
                  if (!r.ok) setMsg(r.msg);
                  else {
                    setOpen(false);
                    setHint("");
                    router.refresh();
                  }
                })
              }
            >
              AI 없이 바로 표시
            </button>
            <button className="text-xs text-slate-500" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {active && check && (
        <div className="text-xs text-orange-700 space-y-1">
          <p>{check.message}</p>
          <button
            className="text-slate-500 hover:underline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await cancelErrorCheckAction(code, label);
                setCheck(null);
              })
            }
          >
            취소
          </button>
        </div>
      )}

      {check && !active && (check.stage === "rx_done" || check.stage === "rx_error") && (
        <div className="text-xs space-y-1">
          <p className={check.stage === "rx_error" ? "text-red-600" : "text-slate-600"}>{check.message}</p>
          <div className="flex flex-wrap gap-2">
            {!suspected && (
              <button
                className="text-slate-500 hover:underline"
                onClick={() =>
                  start(async () => {
                    await discardErrorCheckAction(code, label);
                    setCheck(null);
                  })
                }
              >
                결과 닫기
              </button>
            )}
            <button
              className="text-slate-500 hover:underline"
              onClick={() =>
                start(async () => {
                  await discardErrorCheckAction(code, label);
                  setCheck(null);
                  setOpen(true);
                })
              }
            >
              다시 살펴보게 하기
            </button>
          </div>
        </div>
      )}

      {suspected && (
        <button
          className="mt-1 text-xs text-slate-500 hover:underline block"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setErrorFlagAction(code, label, false, "");
              if (r.ok) router.refresh();
            })
          }
        >
          표시 해제
        </button>
      )}

      {msg && <p className="text-xs text-red-600 mt-1">{msg}</p>}
    </div>
  );
}
