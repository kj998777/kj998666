"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cancelDigitizeAction, pollDigitizeAction, startDigitizeAction, type DigitizePoll } from "./digitize-actions";

const ACTIVE = new Set(["dg_upload", "dg_submit", "dg_wait"]);

const STAGE_LABEL: Record<string, string> = {
  dg_upload: "시험지 업로드",
  dg_submit: "쪽별 옥겼 적기 요청",
  dg_wait: "옥겼 적기 대기",
  dg_done: "완료",
  dg_error: "오류",
};

export default function DigitizeControl({
  code,
  initial,
  isScanned,
}: {
  code: string;
  initial: DigitizePoll;
  isScanned: boolean | null;
}) {
  const [job, setJob] = useState<DigitizePoll>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function stop() {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
    if (job && ACTIVE.has(job.stage)) {
      timer.current = setInterval(() => {
        start(async () => {
          const r = await pollDigitizeAction(code);
          setJob(r);
        });
      }, 4000);
    } else {
      stop();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.stage, code]);

  const active = job ? ACTIVE.has(job.stage) : false;

  return (
    <div className="card space-y-2">
      <h2 className="font-medium">스캔 시험지 디지털화</h2>
      <p className="text-sm text-slate-500">
        스캔본(그림) 시험지의 글자·수식·그림 위치를 AI가 쪽별로 옥겼 적습니다. 새 PDF를 자동으로
        조판해 주지는 않고, 결과를 JSON으로 내려받아 검토·재사용할 수 있습니다.
        {isScanned === false && " (업로드된 PDF는 이미 글자 정보가 있어 보여 꼭 필요하지는 않을 수 있습니다.)"}
      </p>

      {!job && (
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg("");
              const r = await startDigitizeAction(code);
              if (!r.ok) setMsg(r.msg);
              else setJob({ stage: "dg_upload", message: "시험지를 AI에 올리는 중…", updatedAt: new Date().toISOString(), progress: null });
            })
          }
        >
          디지털화 시작
        </button>
      )}

      {job && (
        <div className="text-sm space-y-2">
          <p className={job.stage === "dg_error" ? "text-red-600" : "text-slate-700"}>
            {STAGE_LABEL[job.stage] ?? job.stage} — {job.message}
          </p>
          {job.progress && job.progress.total > 0 && (
            <div>
              <div className="h-2 bg-slate-100 rounded overflow-hidden">
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${Math.min(100, Math.round((job.progress.done / job.progress.total) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {job.progress.done}/{job.progress.total}쪽
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {active && (
              <button
                className="text-slate-500 hover:underline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg("");
                    const r = await cancelDigitizeAction(code);
                    if (!r.ok) setMsg(r.msg ?? "취소하지 못했습니다.");
                    else setJob({ stage: "dg_error", message: "선생님이 디지털화를 취소했습니다.", updatedAt: new Date().toISOString(), progress: null });
                  })
                }
              >
                취소
              </button>
            )}
            {!active && (
              <button
                className="btn-secondary text-sm px-2 py-1"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg("");
                    const r = await startDigitizeAction(code);
                    if (!r.ok) setMsg(r.msg);
                    else setJob({ stage: "dg_upload", message: "시험지를 AI에 올리는 중…", updatedAt: new Date().toISOString(), progress: null });
                  })
                }
              >
                다시 시작
              </button>
            )}
            {job.stage === "dg_done" && (
              <a className="text-slate-500 hover:underline" href={`/exams/${encodeURIComponent(code)}/digitized`} target="_blank">
                결과 JSON 내려받기
              </a>
            )}
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cancelDigitizeAction, pollDigitizeAction, startDigitizeAction, type DigitizePoll } from "./digitize-actions";

const ACTIVE = new Set(["dg_upload", "dg_submit", "dg_wait"]);

const STAGE_LABEL: Record<string, string> = {
    dg_upload: "시험지 업로드",
    dg_submit: "쪽별 옮겨 적기 요청",
    dg_wait: "옮겨 적기 대기",
    dg_done: "완료",
    dg_error: "오류",
};

export default function DigitizeControl({
    code,
    initial,
    isScanned,
}: {
    code: string;
    initial: DigitizePoll;
    isScanned: boolean | null;
}) {
    const [job, setJob] = useState<DigitizePoll>(initial);
    const [pending, start] = useTransition();
    const [msg, setMsg] = useState("");
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
        function stop() {
                if (timer.current) clearInterval(timer.current);
                timer.current = null;
        }
        if (job && ACTIVE.has(job.stage)) {
                timer.current = setInterval(() => {
                          start(async () => {
                                      const r = await pollDigitizeAction(code);
                                      setJob(r);
                          });
                }, 4000);
        } else {
                stop();
        }
        return stop;
        // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.stage, code]);

  const active = job ? ACTIVE.has(job.stage) : false;

  return (
        <div className="card space-y-2">
              <h2 className="font-medium">스캔 시험지 디지털화</h2>h2>
              <p className="text-sm text-slate-500">
                      스캔본(그림) 시험지의 글자·수식·그림 위치를 AI가 쪽별로 옮겨 적습니다. 새 PDF를 자동으로
                      조판해 주지는 않고, 결과를 JSON으로 내려받아 검토·재사용할 수 있습니다.
                {isScanned === false && " (업로드된 PDF는 이미 글자 정보가 있어 보여 꼭 필요하지는 않을 수 있습니다.)"}
              </p>p>
        
          {!job && (
                  <button
                              className="btn-secondary"
                              disabled={pending}
                              onClick={() =>
                                            start(async () => {
                                                            setMsg("");
                                                            const r = await startDigitizeAction(code);
                                                            if (!r.ok) setMsg(r.msg);
                                                            else setJob({ stage: "dg_upload", message: "시험지를 AI에 올리는 중…", updatedAt: new Date().toISOString(), progress: null });
                                            })
                              }
                            >
                            디지털화 시작
                  </button>button>
              )}
        
          {job && (
                  <div className="text-sm space-y-2">
                            <p className={job.stage === "dg_error" ? "text-red-600" : "text-slate-700"}>
                              {STAGE_LABEL[job.stage] ?? job.stage} — {job.message}
                            </p>p>
                    {job.progress && job.progress.total > 0 && (
                                <div>
                                              <div className="h-2 bg-slate-100 rounded overflow-hidden">
                                                              <div
                                                                                  className="h-full bg-sky-500"
                                                                                  style={{ width: `${Math.min(100, Math.round((job.progress.done / job.progress.total) * 100))}%` }}
                                                                                />
                                              </div>div>
