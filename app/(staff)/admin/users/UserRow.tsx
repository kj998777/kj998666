"use client";

import { useState, useTransition } from "react";
import { changeRole, revokeUser } from "./actions";
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

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-2">
        {profile.email} {isMe && <span className="text-slate-400">(나)</span>}
        {tutorStats && (
          <div className="text-xs text-slate-400 mt-0.5">
            포인트 {tutorStats.points_balance} · 제출 {tutorStats.reviews_submitted}건
            {tutorStats.reviews_flagged > 0 && (
              <span className="text-red-500"> · 불일치 {tutorStats.reviews_flagged}건</span>
            )}
          </div>
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
