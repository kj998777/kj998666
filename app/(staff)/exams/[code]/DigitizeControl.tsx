"use client";

import FigureFixPanel from "./FigureFixPanel";
import ScanRestoreBox from "./ScanRestoreBox";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyDigitizedPdfAsOriginal,
  cancelDigitizeAction,
  startDigitizeAction,
  type DigitizePoll,
} from "./digitize-actions";
import { pollJob } from "@/lib/jobPoll";
import { uploadPdfDirect } from "@/lib/supabase/uploadPdf";

const ACTIVE = new Set(["dg_upload", "dg_submit", "dg_wait"]);

const STAGE_LABEL: Record<string, string> = {
  dg_upload: "시험지 업로드",
  dg_submit: "쪽별 옮겨 적기 요청",
  dg_wait: "옮겨 적기 대기",
  dg_done: "완료",
  dg_error: "오류",
};

// 2026-09-29: 그림 자리 자동 보정 안내(buildDigitizedPdf의 figFixed / figSuspect)
function figNote(b: { figFixed?: string[]; figSuspect?: string[] }): string {
  const parts: string[] = [];
  if (b.figFixed?.length) parts.push(`그림 자리 자동 보정 ${b.figFixed.length}곳(${b.figFixed.join(", ")}번 — 확인해 주세요)`);
  if (b.figSuspect?.length) parts.push(`그림을 못 찾은 곳 ${b.figSuspect.length}곳(${b.figSuspect.join(", ")}번 — 원본과 비교해 주세요)`);
  return parts.length ? " · " + parts.join(" · ") + " — 아래 '그림 자리 직접 고치기'에서 고칠 수 있어요" : "";
}

export default function DigitizeControl({
  code,
  examId,
  examName,
  initial,
  isScanned,
  appliedAsOriginal,
  scanMissing,
}: {
  code: string;
  examId: string;
  examName: string;
  initial: DigitizePoll;
  isScanned: boolean | null;
  appliedAsOriginal?: boolean;
  // 2026-09-29: 원본으로 적용하면서 스캔본이 지워진 예전 시험(page.tsx가 확인)
  scanMissing?: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = useState<DigitizePoll>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [pdfMsg, setPdfMsg] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);

  async function onDownloadPdf() {
    setPdfBusy(true);
    setPdfMsg("시작하는 중…");
    try {
      const { buildDigitizedPdf, downloadPdfBytes } = await import("./buildDigitizedPdf");
      const built = await buildDigitizedPdf(code, examName, (m) => setPdfMsg(m));
      downloadPdfBytes(built.bytes, `${examName}_디지털시험지.pdf`);
      setPdfMsg(
        `저장했습니다 (${built.pages}쪽 · 문항 ${built.items}개 · 그림 ${built.figs}개${
          (built.figErrors ? ` · 그림 오류 ${built.figErrors}곳` : "") + figNote(built)
        }). 옮겨 적은 글·수식·그림은 AI가 읽은 것이니 원본과 대조한 뒤 나눠 주세요.`
      );
    } catch (e: any) {
      setPdfMsg("실패: " + (e && e.message ? e.message : String(e)));
    } finally {
      setPdfBusy(false);
    }
  }

  // #2(2026-09-28): 다운로드 후 수동 재업로드를 거치지 않고, 브라우저에서 만든 디지털 시험지 PDF를
  // 곧바로 이 시험의 "원본" 자리에 덮어쓴다(원클릭 적용). 조판(buildDigitizedPdf) 자체는 브라우저
  // 캔버스·pdf.js에 의존하는 순수 브라우저 코드라 서버에서는 만들 수 없으므로, 여기서 만든 결과를
  // 브라우저가 그대로 Storage에 올린 뒤 서버 액션(applyDigitizedPdfAsOriginal)으로 뒷정리만 한다.
  async function onApplyAsOriginal() {
    setApplyBusy(true);
    setApplyMsg("시작하는 중…");
    try {
      const { buildDigitizedPdf } = await import("./buildDigitizedPdf");
      const built = await buildDigitizedPdf(code, examName, (m) => setApplyMsg(m));
      setApplyMsg("새 원본 PDF를 올리는 중…");
      const blob = new Blob([built.bytes as any], { type: "application/pdf" });
      await uploadPdfDirect(examId, blob);
      setApplyMsg("정리하는 중…");
      // 새로 조판한 PDF에서 잰 문항 자리도 함께 넘긴다(과외선생님 화면의 문항 잘라 보기가 새 PDF와 맞도록)
      const r = await applyDigitizedPdfAsOriginal(code, built.locations);
      if (!r.ok) throw new Error(r.msg ?? "적용하지 못했습니다.");
      setApplyMsg(
        `적용했습니다 (${built.pages}쪽 · 문항 ${built.items}개 · 그림 ${built.figs}개${
          (built.figErrors ? ` · 그림 오류 ${built.figErrors}곳` : "") + figNote(built)
        }). 이제 이 디지털 시험지가 원본 PDF입니다 — 원본과 대조해 확인해 주세요.`
      );
      router.refresh();
    } catch (e: any) {
      setApplyMsg("실패: " + (e && e.message ? e.message : String(e)));
    } finally {
      setApplyBusy(false);
    }
  }

  useEffect(() => {
    function stop() {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
    // 2026-09-29 최적화: fetch로 확인(화면 이동을 막지 않음), 앞선 확인이 끝나기 전에는 새로 부르지 않음.
    // 디지털화는 이 화면의 확인이 진행을 밀어 주므로 다른 탭을 봐도 계속 확인한다.
    if (job && ACTIVE.has(job.stage)) {
      timer.current = setInterval(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          const r = await pollJob<DigitizePoll>(code, "digitize");
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

  const active = job ? ACTIVE.has(job.stage) : false;

  return (
    <div className="card space-y-2">
      <h2 className="font-medium">스캔 시험지 디지털화</h2>
      <p className="text-sm text-slate-500">
        스캔본(그림) 시험지의 글자·수식·그림 위치를 AI가 쪽별로 옮겨 적고, 학원 양식(2단 편집)으로
        다시 조판한 PDF를 만듭니다(문제 쪽만 — 표지·정답·해설·마킹 쪽은 넣지 않습니다). 완료되면
        내려받아 대조해도 되고, &ldquo;원본으로 적용&rdquo; 버튼으로 이 시험의 원본 PDF를 바로 바꿔치기할 수도
        있습니다. 옮겨 적은 내용은 AI가 읽은 것이라 원본과 다를 수 있으니 꼭 대조해 주세요.
        {isScanned === false && " (업로드된 PDF는 이미 글자 정보가 있어 보여 꼭 필요하지는 않을 수 있습니다.)"}
      </p>
      {appliedAsOriginal && (
        <p className="text-xs text-emerald-600">
          현재 이 시험의 원본 PDF는 디지털화 결과가 적용된(다시 조판된) 버전입니다.
        </p>
      )}

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
              <button className="btn-primary text-sm px-2 py-1" disabled={applyBusy || pdfBusy} onClick={onApplyAsOriginal}>
                {applyBusy ? "적용하는 중…" : "디지털 시험지를 원본으로 적용"}
              </button>
            )}
            {job.stage === "dg_done" && (
              <button className="btn-secondary text-sm px-2 py-1" disabled={pdfBusy || applyBusy} onClick={onDownloadPdf}>
                디지털 시험지 PDF 다운로드
              </button>
            )}
            {job.stage === "dg_done" && (
              <a className="text-slate-500 hover:underline" href={`/exams/${encodeURIComponent(code)}/digitized`} target="_blank">
                원자료 JSON 내려받기
              </a>
            )}
          </div>
          {job.stage === "dg_done" && scanMissing && <ScanRestoreBox code={code} examId={examId} />}
          {job.stage === "dg_done" && !scanMissing && (
            <div>
              <FigureFixPanel code={code} />
            </div>
          )}
          {applyMsg && <p className={applyMsg.indexOf("실패") === 0 ? "text-red-600" : "text-slate-500"}>{applyMsg}</p>}
          {pdfMsg && <p className={pdfMsg.indexOf("실패") === 0 ? "text-red-600" : "text-slate-500"}>{pdfMsg}</p>}
        </div>
      )}

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
