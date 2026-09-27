"use client";

import { useState, useTransition } from "react";
import { adjustTutorPoints, changeRole, revokeUser } from "./actions";
import type { Role } from "@/lib/supabase/types";

type Profile = { id: string; email: string; role: Role; created_at: string };
type TutorStats = { points_balance: number; reviews_submitted: number; reviews_flagged: number };

export default function UserRow({
  profile,
  isMe,
  tutorStats,
}: {
  profile: Profile;
  isMe: boolean;
  tutorStats?: TutorStats;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  // #115: 관리자가 이 과외선생님 계정의 포인트를 임의로 지급/차감(테스트용). tutorStats가 있는
  // (=role이 tutor인) 행에서만 노출한다.
  const [pointsPending, startPoints] = useTransition();
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");
  const [pointsMsg, setPointsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pointsBalance, setPointsBalance] = useState(tutorStats?.points_balance ?? 0);

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-2">
        {profile.email} {isMe && <span className="text-slate-400">(나)</span>}
        {tutorStats && (
          <>
            <div className="text-xs text-slate-400 mt-0.5">
              포인트 {pointsBalance} · 제출 {tutorStats.reviews_submitted}건
              {tutorStats.reviews_flagged > 0 && (
                <span className="text-red-500"> · 불일치 {tutorStats.reviews_flagged}건</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="number"
                className="input py-0.5 px-1 w-16 text-xs"
                placeholder="±점수"
                value={pointsDelta}
                disabled={pointsPending}
                onChange={(e) => setPointsDelta(e.target.value)}
              />
              <input
                type="text"
                className="input py-0.5 px-1 w-24 text-xs"
                placeholder="메모(선택)"
                value={pointsNote}
                disabled={pointsPending}
                onChange={(e) => setPointsNote(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary py-0.5 px-2 text-xs"
                disabled={pointsPending || !pointsDelta.trim()}
                onClick={() => {
                  const delta = Number(pointsDelta);
                  if (!Number.isFinite(delta) || delta === 0) {
                    setPointsMsg({ ok: false, text: "0이 아닌 숫자를 입력해 주세요." });
                    return;
                  }
                  setPointsMsg(null);
                  startPoints(async () => {
                    const r = await adjustTutorPoints(profile.id, delta, pointsNote);
                    if (!r.ok) {
                      setPointsMsg({ ok: false, text: r.msg ?? "실패했습니다." });
                      return;
                    }
                    if (typeof r.newBalance === "number") setPointsBalance(r.newBalance);
                    setPointsMsg({ ok: true, text: `적용됨(잔액 ${r.newBalance})` });
                    setPointsDelta("");
                    setPointsNote("");
                  });
                }}
              >
                적용
              </button>
            </div>
            {pointsMsg && (
              <div className={`text-xs mt-0.5 ${pointsMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                {pointsMsg.text}
              </div>
            )}
          </>
        )}
      </td>
      <td className="py-2 pr-2">
        <select
          className="input py-1"
          defaultValue={profile.role}
          disabled={pending || isMe}
          onChange={(e) => {
            setErr("");
            const role = e.target.value as Role;
            start(async () => {
              const r = await changeRole(profile.id, role);
              if (!r.ok) setErr(r.msg ?? "실패했습니다.");
            });
          }}
        >
          <option value="viewer">뷰어</option>
          <option value="editor">편집자</option>
          <option value="admin">관리자</option>
          <option value="tutor">과외선생님</option>
        </select>
        {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
      </td>
      <td className="py-2 pr-2 text-slate-500">
        {new Date(profile.created_at).toLocaleDateString("ko-KR")}
      </td>
      <td className="py-2 pr-2 text-right">
        {!isMe && (
          <button
            className="btn-danger py-1 px-3"
            disabled={pending}
            onClick={() => {
              if (!confirm(`${profile.email} 계정을 삭제할까요? 로그인이 즉시 막힙니다.`)) return;
              setErr("");
              start(async () => {
                const r = await revokeUser(profile.id);
                if (!r.ok) setErr(r.msg ?? "실패했습니다.");
              });
            }}
          >
            삭제
          </button>
        )}
      </td>
    </tr>
  );
}
