"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cancelAiProcessing, startAiProcessing, type JobPoll } from "../ai-actions";
import { pollJob, pageVisible } from "@/lib/jobPoll";
import { ACTIVE, STAGE_LABEL } from "../aiJobStage";

export default function AiJobPanel({ code, initial }: { code: string; initial: JobPoll }) {
  const [job, setJob] = useState<JobPoll>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    function stop() {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
    // 2026-09-29 최적화: fetch로 확인(화면 이동을 막지 않음), 겹쳐 부르지 않음, 다른 탭을 보는 동안은 쉼(서버 1분 자동 작업이 계속 진행)
    if (job && ACTIVE.has(job.stage)) {
      timer.current = setInterval(async () => {
        if (busy.current || !pageVisible()) return;
        busy.current = true;
        try {
          const r = await pollJob<JobPoll>(code, "ai");
          if (r.ok) setJob(r.data);
        } finally {
          busy.current = false;
        }
      }, 5000);
    } else {
      stop();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.stage, code]);

  if (!job) return null;

  const active = ACTIVE.has(job.stage);
  const label = STAGE_LABEL[job.stage] ?? job.stage;

  return (
    <div className="card border-sky-300 bg-sky-50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sky-900">AI 자동 처리 — {label}</h2>
        {active && <span className="text-xs text-sky-700">{pending ? "확인 중…" : "자동 진행 중"}</span>}
      </div>
      <p className="text-sm text-sky-800 mt-1 whitespace-pre-wrap">{job.message}</p>
      {job.progress && job.progress.total > 0 && (
        <div className="mt-2">
          <div className="h-2 bg-sky-100 rounded overflow-hidden">
            <div
              className="h-full bg-sky-500"
              style={{ width: `${Math.min(100, Math.round((job.progress.done / job.progress.total) * 100))}%` }}
            />
          </div>
          <p className="text-xs text-sky-700 mt-1">
            {job.progress.done}/{job.progress.total} 문항
          </p>
        </div>
      )}
      {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}
      <div className="mt-3 flex gap-2">
        {active && (
          <button
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg("");
                const r = await cancelAiProcessing(code);
                if (!r.ok) setMsg(r.msg ?? "취소하지 못했습니다.");
                else setJob({ stage: "error", message: "선생님이 처리를 취소했습니다.", updatedAt: new Date().toISOString(), progress: null });
              })
            }
          >
            취소
          </button>
        )}
        {job.stage === "error" && (
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg("");
                const r = await startAiProcessing(code);
                if (!r.ok) setMsg(r.msg ?? "다시 시작하지 못했습니다.");
                else setJob({ stage: "upload", message: "시험지를 AI에 올리는 중…", updatedAt: new Date().toISOString(), progress: null });
              })
            }
          >
            같은 PDF로 다시 시도
          </button>
        )}
      </div>
    </div>
  );
}
