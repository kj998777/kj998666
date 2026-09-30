"use client";

import { useState, useTransition } from "react";
import { backupNow, getBackupUrl, rejudgeNow, resetTutorTrust, setTutorPaused } from "./actions";

export function BackupNowButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-1">
      <button
        className="btn-secondary py-1 px-3 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await backupNow();
            setMsg({ ok: r.ok, text: r.msg ?? (r.ok ? "백업했습니다." : "실패했습니다.") });
          })
        }
      >
        {pending ? "백업하는 중…" : "지금 백업"}
      </button>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}

export function BackupDownloadButton({ name }: { name: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button
        className="text-sm link-accent"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await getBackupUrl(name);
            if (r.ok && r.url) window.location.href = r.url;
            else setErr(r.msg ?? "실패");
          })
        }
      >
        {pending ? "준비 중…" : "내려받기"}
      </button>
      {err && <span className="text-xs text-red-600 ml-1">{err}</span>}
    </>
  );
}

export function TrustControls({ tutorId, level, manualPaused }: { tutorId: string; level: string; manualPaused: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 justify-end">
      {(level === "watch" || level === "paused") && (
        <button
          className="btn-secondary py-0.5 px-2 text-xs"
          disabled={pending}
          title="지금까지의 판정(정답률)을 빼고 다시 셉니다(기록은 남음)"
          onClick={() =>
            start(async () => {
              if (!confirm("이 과외선생님의 신뢰도를 초기화할까요? 정답률을 처음부터 다시 세고, 정지도 풀립니다.")) return;
              setErr("");
              const r = await resetTutorTrust(tutorId);
              if (!r.ok) setErr(r.msg ?? "실패");
            })
          }
        >
          신뢰도 초기화
        </button>
      )}
      <button
        className="btn-secondary py-0.5 px-2 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await setTutorPaused(tutorId, !manualPaused);
            if (!r.ok) setErr(r.msg ?? "실패");
          })
        }
      >
        {manualPaused ? "검토 재개" : "검토 정지"}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

/** 정답률 기록 다시 맞추기 — 먼저 몇 건인지 보고, 그다음 고친다(2026-09-30) */
export function RejudgeButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ready, setReady] = useState(0);
  const run = (apply: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await rejudgeNow(apply);
      setMsg({ ok: r.ok, text: r.msg ?? (r.ok ? "끝났습니다." : "실패했습니다.") });
      setReady(!apply && r.ok ? r.flips ?? 0 : 0);
    });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary py-1 px-3 text-sm" disabled={pending} onClick={() => run(false)}>
          {pending && !ready ? "살펴보는 중…" : "몇 건인지 보기"}
        </button>
        {ready > 0 && (
          <button type="button" className="btn-primary py-1 px-3 text-sm" disabled={pending} onClick={() => run(true)}>
            {pending ? "고치는 중…" : `${ready}건 "맞음"으로 고치기`}
          </button>
        )}
      </div>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
