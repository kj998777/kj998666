"use client";

import { useState, useTransition } from "react";
import { backupNow, getBackupUrl, resetTutorTrust, setTutorPaused } from "./actions";

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
      {level !== "ok" && (
        <button
          className="btn-secondary py-0.5 px-2 text-xs"
          disabled={pending}
          title="지금까지의 불일치를 기준점으로 잡고 0부터 다시 셉니다(기록은 남음)"
          onClick={() =>
            start(async () => {
              if (!confirm("이 과외선생님의 신뢰도를 초기화할까요? 불일치를 0부터 다시 세고, 정지도 풀립니다.")) return;
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
