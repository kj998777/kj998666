"use client";

import { useState, useTransition } from "react";
import { backupNow, getBackupUrl, regradeAllNow, rejudgeNow, resetTutorTrust, setTutorPaused } from "./actions";
import type { RegradeAllReport } from "@/lib/ops/regradeAll";

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

/** 전체 재채점(2026-10-03): 미리보기 → 실행 두 단계. 바뀌는 학생·점수를 표로 보여 준다. */
export function RegradeAllButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [report, setReport] = useState<RegradeAllReport | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const run = (apply: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await regradeAllNow(apply);
      setMsg({ ok: r.ok, text: r.msg ?? (r.ok ? "끝났습니다." : "실패했습니다.") });
      setReport(r.ok ? r.report ?? null : null);
      setPreviewed(r.ok && !apply && (r.report?.changed ?? 0) > 0);
    });
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary py-1 px-3 text-sm" disabled={pending} onClick={() => run(false)}>
          {pending && !previewed ? "살펴보는 중…" : "무엇이 바뀌는지 보기"}
        </button>
        {previewed && (
          <button type="button" className="btn-primary py-1 px-3 text-sm" disabled={pending} onClick={() => run(true)}>
            {pending ? "다시 채점하는 중…" : `${report?.changed ?? 0}건 다시 채점하기`}
          </button>
        )}
      </div>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
      {report && report.exams.length > 0 && (
        <div className="table-wrap">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">시험</th>
                <th className="py-1 pr-2">학생</th>
                <th className="py-1 pr-2 text-right">점수</th>
                <th className="py-1 pr-2">정오가 바뀐 문항</th>
              </tr>
            </thead>
            <tbody>
              {report.exams.flatMap((e) =>
                e.changes.map((c, i) => (
                  <tr key={e.examId + i} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{i === 0 ? `${e.name} (${e.code})` : ""}</td>
                    <td className="py-1 pr-2">{c.student}</td>
                    <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">
                      {fmt(c.from)} → <b>{fmt(c.to)}</b>
                    </td>
                    <td className="py-1 pr-2">{c.flipped.join(", ") || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
