"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pollAiJob } from "../../exams/ai-actions";
import { pollDigitizeAction } from "../../exams/[code]/digitize-actions";
import { ACTIVE as AI_ACTIVE, STAGE_LABEL as AI_LABEL } from "../../exams/aiJobStage";

// 디지털화(dg_*) 단계 이름표 — aiJobStage.ts 와 같은 표를 쓰고 싶지만 단계 이름 체계가 달라(dg_ 접두사)
// 별도로 둔다. exam_jobs 쪽 표는 aiJobStage.ts 걸 그대로 재사용(AiJobPanel과 완전히 같은 표기 유지).
const DG_ACTIVE = new Set(["dg_upload", "dg_submit", "dg_wait"]);
const DG_LABEL: Record<string, string> = {
  dg_upload: "시험지 업로드",
  dg_submit: "디지털화 요청",
  dg_wait: "디지털화 대기",
  dg_done: "완료",
  dg_error: "오류",
};

export type UploadJobRow = { code: string; name: string; stage: string; message: string; updatedAt: string };

function timeAgo(iso: string) {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}

type PollFn = (code: string) => Promise<{ stage: string; message: string; updatedAt: string } | null>;
type SetRows = (updater: UploadJobRow[] | ((prev: UploadJobRow[]) => UploadJobRow[])) => void;

// 이 페이지에 떠 있는 동안, 진행 중인 항목들을 실제로 폴링(=한 걸음씩 진행, lazy tick)한다 —
// 그냥 읽기만 하면 다른 화면을 아무도 열어 두지 않은 작업은 여기서도 멈춘 것처럼 보이기 때문에,
// AiJobPanel과 같은 방식으로 이 패널 자체가 진행을 밀어준다.
function JobList({
  rows,
  setRows,
  labels,
  activeStages,
  doneStage,
  errorStage,
  poll,
}: {
  rows: UploadJobRow[];
  setRows: SetRows;
  labels: Record<string, string>;
  activeStages: Set<string>;
  doneStage: string;
  errorStage: string;
  poll: PollFn;
}) {
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [pending, start] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => {
      const targets = rowsRef.current.filter((r) => activeStages.has(r.stage));
      if (targets.length === 0) return;
      start(async () => {
        const results = await Promise.all(targets.map(async (r) => ({ code: r.code, res: await poll(r.code) })));
        setRows((prev) => {
          let next = prev;
          for (const { code, res } of results) {
            if (!res || res.stage === doneStage) {
              next = next.filter((row) => row.code !== code);
            } else {
              next = next.map((row) =>
                row.code === code ? { ...row, stage: res.stage, message: res.message, updatedAt: res.updatedAt } : row
              );
            }
          }
          return next;
        });
      });
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows.length === 0) return <p className="text-sm text-slate-500">지금 처리 중인 시험이 없습니다.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400 border-b border-slate-200">
          <th className="py-1 pr-2 font-normal">시험</th>
          <th className="py-1 pr-2 font-normal">단계</th>
          <th className="py-1 pr-2 font-normal">메시지</th>
          <th className="py-1 pr-2 font-normal">갱신</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code} className="border-b border-slate-100 last:border-0 align-top">
            <td className="py-1.5 pr-2 whitespace-nowrap">
              <Link href={`/exams/${encodeURIComponent(r.code)}`} className="link-accent">
                {r.name}
              </Link>
              <span className="text-slate-400"> ({r.code})</span>
            </td>
            <td className="py-1.5 pr-2 whitespace-nowrap">
              <span className={"badge " + (r.stage === errorStage ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700")}>
                {labels[r.stage] ?? r.stage}
              </span>
            </td>
            <td className="py-1.5 pr-2 text-slate-600">{r.message}</td>
            <td className="py-1.5 pr-2 text-slate-400 whitespace-nowrap">{timeAgo(r.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
      {pending && (
        <tfoot>
          <tr>
            <td colSpan={4} className="text-xs text-slate-400 pt-1">
              확인 중…
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export default function UploadStatusPanel({
  initialExamJobs,
  initialDigitizeJobs,
}: {
  initialExamJobs: UploadJobRow[];
  initialDigitizeJobs: UploadJobRow[];
}) {
  const router = useRouter();
  const [examJobs, setExamJobs] = useState(initialExamJobs);
  const [digitizeJobs, setDigitizeJobs] = useState(initialDigitizeJobs);
  const [refreshing, startRefresh] = useTransition();

  // "새로고침" 버튼으로 서버 재조회가 오면(예: 다른 화면에서 방금 새 작업을 시작한 경우) 로컬 상태에
  // 반영한다. 폴링 자체는 이 값을 직접 바꾸지 않으므로(=setExamJobs를 통해서만 바뀜) 충돌 없음.
  useEffect(() => setExamJobs(initialExamJobs), [initialExamJobs]);
  useEffect(() => setDigitizeJobs(initialDigitizeJobs), [initialDigitizeJobs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">업로드·처리 현황</h2>
        <button
          className="btn-secondary py-1 px-3 text-xs"
          disabled={refreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          {refreshing ? "새로고침 중…" : "새로고침"}
        </button>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-1">새 시험 자동 처리(AI)</h3>
        <JobList
          rows={examJobs}
          setRows={setExamJobs}
          labels={AI_LABEL}
          activeStages={AI_ACTIVE}
          doneStage="done"
          errorStage="error"
          poll={pollAiJob}
        />
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-1">스캔 시험지 디지털화</h3>
        <JobList
          rows={digitizeJobs}
          setRows={setDigitizeJobs}
          labels={DG_LABEL}
          activeStages={DG_ACTIVE}
          doneStage="dg_done"
          errorStage="dg_error"
          poll={pollDigitizeAction}
        />
      </div>
      <p className="text-xs text-slate-400">
        검수 대기 중인 시험은 여기 대신 시험 목록 폴더 트리의 &quot;검수대기&quot; 표시를 확인해 주세요.
      </p>
    </div>
  );
}
