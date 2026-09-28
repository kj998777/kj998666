"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pollLocateItems, startLocateItems } from "./actions";

// 과외선생님 검토 화면에서 "그 문항만" 잘라 보여 주려면 문항 영역 좌표가 필요한데, 2026-09-27 저녁 전에 AI 처리한
// 시험에는 좌표가 없어 쪽 전체가 보인다. 이 패널에서 좌표가 없는 검토 대기 문항 수를 보여 주고, 버튼 한 번으로
// AI에게 영역만 다시 찾게 한다(lib/ai/locate.ts). 진행 중이면 20초마다 한 걸음씩 진행·새로고침한다.

type Job = { examId: string; stage: string; message: string; updatedAt: string; examName: string };

export default function LocatePanel({ missingItems, jobs }: { missingItems: number; jobs: Job[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const active = jobs.filter((j) => j.stage === "submit" || j.stage === "wait");

  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(() => {
      pollLocateItems()
        .then(() => router.refresh())
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(t);
  }, [active.length, router]);

  if (!missingItems && !active.length) return null;

  const recent = jobs.filter((j) => j.stage !== "done" || Date.now() - new Date(j.updatedAt).getTime() < 6 * 3600_000).slice(0, 12);

  return (
    <div className="card border-sky-200 bg-sky-50 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-sky-900">문항 잘라 보기 영역</h2>
          <p className="text-sm text-sky-800">
            검토 대기 문항 중 {missingItems}개는 문항 영역 좌표가 없어, 과외선생님 화면에 문항 대신 쪽 전체가 보입니다.
          </p>
        </div>
        <button
          className="btn-primary py-1 px-3 text-sm"
          disabled={pending || active.length > 0 || !missingItems}
          onClick={() =>
            start(async () => {
              setMsg("");
              const r = await startLocateItems();
              setMsg(r.msg ?? "");
              router.refresh();
            })
          }
        >
          {active.length ? "영역 찾는 중…" : pending ? "시작하는 중…" : "AI로 문항 영역 찾기"}
        </button>
      </div>
      {msg && <p className="text-sm text-sky-900">{msg}</p>}
      {recent.length > 0 && (
        <ul className="text-xs text-sky-900 space-y-0.5">
          {recent.map((j) => (
            <li key={j.examId}>
              <span className="font-medium">{j.examName}</span> — {j.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
