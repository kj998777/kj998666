"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startLocateItems } from "./actions";

// 과외선생님 검토 화면에서 "그 문항만" 잘라 보여 주려면 문항 영역 좌표가 필요한데, 2026-09-27 저녁 전에 AI 처리한
// 시험에는 좌표가 없어 쪽 전체가 보인다. 이 패널에서 좌표가 없는 검토 대기 문항 수를 보여 주고, 버튼 한 번으로
// AI에게 영역만 다시 찾게 한다(lib/ai/locate.ts). 진행 중이면 20초마다 locate-tick 라우트로 한 걸음씩 진행하고,
// 상태가 바뀌었을 때만 화면을 새로고침한다(2026-09-29: 서버 액션으로 하던 것을 옮김 — 다른 버튼을 막지 않도록).

type Job = { examId: string; stage: string; message: string; updatedAt: string; examName: string };

export default function LocatePanel({ missingItems, jobs }: { missingItems: number; jobs: Job[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const active = jobs.filter((j) => j.stage === "submit" || j.stage === "wait");
  const nSubmit = jobs.filter((j) => j.stage === "submit").length;
  const nWait = jobs.filter((j) => j.stage === "wait").length;
  const busy = useRef(false);
  const lastSig = useRef("");

  const tick = useCallback(async () => {
    if (busy.current) return; // 앞 확인이 아직 안 끝났으면 건너뜀(겹쳐 부르지 않음)
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
    if (!active.length) return;
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, [active.length, tick]);

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
              void tick(); // 기다리지 않고 바로 첫 제출 시작
            })
          }
        >
          {active.length ? "영역 찾는 중…" : pending ? "시작하는 중…" : "AI로 문항 영역 찾기"}
        </button>
      </div>
      {msg && <p className="text-sm text-sky-900">{msg}</p>}
      {active.length > 0 && (
        <p className="text-xs text-sky-800">
          진행 중 {active.length}개 시험
          {nSubmit > 0 && ` · AI에 보내는 중 ${nSubmit}`}
          {nWait > 0 && ` · AI 결과 기다리는 중 ${nWait}`} — AI 일괄 처리(배치)라 보내고 나서 보통 수 분, AI 쪽이 붐비면
          1시간 가까이 걸릴 수 있습니다. 이 화면을 닫아도 1분마다 도는 자동 처리로 계속 진행됩니다.
        </p>
      )}
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
