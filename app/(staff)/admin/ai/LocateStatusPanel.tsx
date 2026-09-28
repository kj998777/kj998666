"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startLocateItems } from "../review-status/actions";

// 2026-09-29 원장님 요청: 문항 영역 찾기(lib/ai/locate.ts, 0024) 진행 상황을 AI 설정 화면에서도 보이게.
// 검토현황의 LocatePanel과 같은 작업 테이블(item_locate_jobs)을 시험별로 보여 주고, 진행 중이면 20초마다
// locate-tick 라우트로 한 걸음씩 밀어 준다(화면을 안 열어도 1분마다 도는 자동 처리로 계속 진행됨).

export type LocateJobRow = {
  examId: string;
  code: string | null;
  name: string;
  stage: string;
  message: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

const LABEL: Record<string, string> = {
  submit: "AI에 보내는 중",
  wait: "AI 결과 대기",
  done: "완료",
  error: "오류",
};
const BADGE: Record<string, string> = {
  submit: "bg-amber-100 text-amber-800",
  wait: "bg-sky-100 text-sky-700",
  done: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};

function timeAgo(iso: string) {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}

export default function LocateStatusPanel({
  available,
  missingItems,
  jobs,
}: {
  available: boolean;
  missingItems: number;
  jobs: LocateJobRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [showDone, setShowDone] = useState(false);
  const busy = useRef(false);
  const lastSig = useRef("");

  const count = (s: string) => jobs.filter((j) => j.stage === s).length;
  const nSubmit = count("submit");
  const nWait = count("wait");
  const nDone = count("done");
  const nError = count("error");
  const active = nSubmit + nWait;

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch("/admin/review-status/locate-tick", { method: "POST", cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.sig && j.sig !== lastSig.current) {
        lastSig.current = j.sig;
        router.refresh();
      }
    } catch {
      /* 다음 주기에 다시 */
    } finally {
      busy.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, [active, tick]);

  if (!available) {
    return (
      <div className="space-y-1">
        <h2 className="font-medium">문항 영역 찾기</h2>
        <p className="text-sm text-slate-500">마이그레이션 0024를 실행하면 여기서 진행 상황을 볼 수 있습니다.</p>
      </div>
    );
  }

  // 진행 중·오류는 항상, 완료는 "완료도 보기"를 켰을 때만(최근 것부터)
  const shown = jobs.filter((j) => j.stage !== "done" || showDone);
  // 진행 중 → 오류 → 완료, 같은 단계 안에서는 오래 기다린 것부터
  const order: Record<string, number> = { wait: 0, submit: 1, error: 2, done: 3 };
  shown.sort(
    (a, b) =>
      (order[a.stage] ?? 9) - (order[b.stage] ?? 9) ||
      (a.stage === "done" ? b.updatedAt.localeCompare(a.updatedAt) : a.createdAt.localeCompare(b.createdAt))
  );

  const canStart = missingItems > 0 || nError > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">문항 영역 찾기</h2>
          <p className="text-sm text-slate-500">
            과외선생님 검토 화면에서 문항만 잘라 보여 주기 위한 좌표를 AI로 찾는 작업입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary py-1 px-3 text-xs" onClick={() => router.refresh()}>
            새로고침
          </button>
          <button
            className="btn-primary py-1 px-3 text-xs"
            disabled={pending || !canStart}
            onClick={() =>
              start(async () => {
                setMsg("");
                const r = await startLocateItems();
                setMsg(r.msg ?? "");
                router.refresh();
                void tick();
              })
            }
          >
            {pending ? "시작하는 중…" : nError ? "오류 난 것 다시 시도 · 새로 찾기" : "AI로 문항 영역 찾기"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="badge bg-slate-100 text-slate-700">좌표 없는 검토 대기 문항 {missingItems}개</span>
        <span className={"badge " + BADGE.submit}>AI에 보내는 중 {nSubmit}</span>
        <span className={"badge " + BADGE.wait}>AI 결과 대기 {nWait}</span>
        <span className={"badge " + BADGE.error}>오류 {nError}</span>
        <span className={"badge " + BADGE.done}>완료 {nDone}</span>
      </div>

      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">
          {nDone ? "진행 중인 작업이 없습니다." : "아직 영역 찾기를 한 시험이 없습니다."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200">
                <th className="py-1 pr-2 font-normal">시험</th>
                <th className="py-1 pr-2 font-normal">단계</th>
                <th className="py-1 pr-2 font-normal">메시지</th>
                <th className="py-1 pr-2 font-normal">시작</th>
                <th className="py-1 pr-2 font-normal">갱신</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.examId} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {j.code ? (
                      <Link href={`/exams/${encodeURIComponent(j.code)}`} className="link-accent">
                        {j.name}
                      </Link>
                    ) : (
                      j.name
                    )}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span className={"badge " + (BADGE[j.stage] ?? "bg-slate-100 text-slate-700")}>
                      {LABEL[j.stage] ?? j.stage}
                    </span>
                    {j.attempts > 0 && j.stage !== "done" && (
                      <span className="text-xs text-slate-400"> · 재시도 {j.attempts}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-600">{j.message}</td>
                  <td className="py-1.5 pr-2 text-slate-400 whitespace-nowrap">{timeAgo(j.createdAt)}</td>
                  <td className="py-1.5 pr-2 text-slate-400 whitespace-nowrap">{timeAgo(j.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          AI 일괄 처리(배치)라 보낸 뒤 보통 수 분, AI 쪽이 붐비면 1시간 가까이 걸릴 수 있습니다. 이 화면을 닫아도
          1분마다 도는 자동 처리로 계속 진행되고, 열어 두면 20초마다 확인합니다.
        </p>
        {nDone > 0 && (
          <button className="text-xs text-slate-500 underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "완료 숨기기" : `완료 ${nDone}개도 보기`}
          </button>
        )}
      </div>
    </div>
  );
}
