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
  examName,
  initial,
  isScanned,
}: {
  code: string;
  examName: string;
  initial: DigitizePoll;
  isScanned: boolean | null;
}) {
  const [job, setJob] = useState<DigitizePoll>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function onDownloadPdf() {
    setPdfBusy(true);
    setPdfMsg("시작하는 중…");
    try {
      const { buildDigitizedPdf, downloadPdfBytes } = await import("./buildDigitizedPdf");
      const built = await buildDigitizedPdf(code, examName, (m) => setPdfMsg(m));
      downloadPdfBytes(built.bytes, `${examName}_디지털시험지.pdf`);
      setPdfMsg(
        `저장했습니다 (${built.pages}쪽 · 문항 ${built.items}개 · 그림 ${built.figs}개${
          built.figErrors ? ` · 그림 오류 ${built.figErrors}곳` : ""
        }). 옮겨 적은 글·수식·그림은 AI가 읽은 것이니 원본과 대조한 뒤 나눠 주세요.`
      );
    } catch (e: any) {
      setPdfMsg("실패: " + (e && e.message ? e.message : String(e)));
    } finally {
      setPdfBusy(false);
    }
  }

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
        스캔본(그림) 시험지의 글자·수식·그림 위치를 AI가 쪽별로 옮겨 적고, 학원 양식(2단 편집)으로
        다시 조판한 PDF로 내려받습니다(문제 쪽만 — 표지·정답·해설·마킹 쪽은 넣지 않습니다). 옮겨 적은
        내용은 AI가 읽은 것이라 원본과 다를 수 있으니, 내려받은 뒤 원본과 대조하고 나눠 주세요.
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
              <button className="btn-secondary text-sm px-2 py-1" disabled={pdfBusy} onClick={onDownloadPdf}>
                디지털 시험지 PDF 다운로드
              </button>
            )}
            {job.stage === "dg_done" && (
              <a className="text-slate-500 hover:underline" href={`/exams/${encodeURIComponent(code)}/digitized`} target="_blank">
                원자료 JSON 내려받기
              </a>
            )}
          </div>
          {pdfMsg && <p className={pdfMsg.indexOf("실패") === 0 ? "text-red-600" : "text-slate-500"}>{pdfMsg}</p>}
        </div>
      )}

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
