"use client";

import { useState, useTransition } from "react";
import { adjustTutorPoints, approveWithStudentNo, changeRole, revealStudentNo, revokeUser, setStudentNo } from "./actions";
import type { Role } from "@/lib/supabase/types";
import { personLabel } from "@/lib/profile/label";

type Profile = { id: string; email: string; role: Role; created_at: string; display_name?: string | null; cohort?: string | null; department?: string | null };
type TutorStats = { points_balance: number; reviews_submitted: number; reviews_flagged: number };

const DEPT_BADGE: Record<string, string> = {
  의대: "bg-rose-100 text-rose-800",
  수의대: "bg-emerald-100 text-emerald-800",
  약대: "bg-sky-100 text-sky-800",
  간호대: "bg-violet-100 text-violet-800",
};

export default function UserRow({
  profile,
  isMe,
  tutorStats,
  approveAsTutor,
  hasStudentNo,
  invitedBy,
}: {
  profile: Profile;
  isMe: boolean;
  tutorStats?: TutorStats;
  // 대기 계정 목록: "과외선생님으로 승인" 버튼을 함께 보여 준다(2026-09-28)
  approveAsTutor?: boolean;
  // 2026-09-29: 학번(0036)이 저장돼 있는지(숫자 자체는 페이지에 싣지 않음 — "보기"를 눌러야 불러옴). undefined = 0036 전
  hasStudentNo?: boolean;
  // 2026-10-01: 친구 초대로 가입했으면 "○○ 초대"(0046)
  invitedBy?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const isPendingRow = profile.role === "대기";
  // 대기 계정 승인용 학번 입력(카카오톡으로 받은 학번을 붙여 넣음)
  const [studentNo, setStudentNoInput] = useState("");

  /** 대기 계정을 승인: 학번을 붙여 넣었으면 저장과 승인을 한 번에, 이미 저장된 학번이 있고 비워 뒀으면 그대로 승인. */
  const approve = (role: Role, sel?: HTMLSelectElement) => {
    setErr("");
    setOkMsg("");
    const no = studentNo.trim();
    if (!no && !hasStudentNo) {
      setErr("학번을 먼저 붙여 넣어 주세요(카카오톡으로 받은 학생증 번호).");
      if (sel) sel.value = profile.role;
      return;
    }
    start(async () => {
      const r: any = no ? await approveWithStudentNo(profile.id, no, role) : await changeRole(profile.id, role);
      if (!r.ok) {
        setErr(r.msg ?? "실패했습니다.");
        if (sel) sel.value = profile.role;
      }
    });
  };

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
        {(profile.display_name || profile.cohort || profile.department) && (
          <div className="font-medium text-slate-900 flex flex-wrap items-center gap-1.5">
            {/* 2026-09-29: 과(0033)를 배지로 — 의대도 보이게(이름 표시 personLabel은 의대를 생략하므로 여기서는 과를 따로 붙임) */}
            {profile.department && (
              <span className={"badge text-xs " + (DEPT_BADGE[profile.department] ?? "bg-slate-100 text-slate-700")}>{profile.department}</span>
            )}
            {(profile.display_name || profile.cohort) && <span>{personLabel({ display_name: profile.display_name, cohort: profile.cohort })}</span>}
          </div>
        )}
        <span className={profile.display_name || profile.cohort ? "text-slate-500" : ""}>{profile.email}</span>{" "}
        {isMe && <span className="text-slate-400">(나)</span>}
        {invitedBy && <div className="text-xs text-sky-700 mt-0.5">{invitedBy}</div>}
        {isPendingRow && !isMe && (
          <div className="mt-1.5">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="input py-1 px-2 w-48 text-sm"
              placeholder={hasStudentNo ? "저장된 학번 있음(바꿀 때만 입력)" : "학번 붙여넣기 (예: 2025XXXXXX)"}
              value={studentNo}
              disabled={pending}
              onChange={(e) => {
                setStudentNoInput(e.target.value);
                setErr("");
              }}
              aria-label="학번(학생증 번호)"
            />
            <div className="text-[11px] text-amber-800 mt-0.5">학번은 관리자만 보며, 이미 다른 계정에 있는 학번이면 승인되지 않습니다.</div>
          </div>
        )}
        {!isPendingRow && !isMe && profile.role !== "admin" && hasStudentNo !== undefined && (
          <StudentNoControl userId={profile.id} initiallySaved={!!hasStudentNo} />
        )}
        {tutorStats && (
          <>
            <div className="text-xs text-slate-400 mt-0.5">
              포인트 {pointsBalance} · 제출 {tutorStats.reviews_submitted}건
              {/* 0037: 불일치 횟수 대신 정답률 등급 — 운영 현황에서 봄 */}
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
            if (isPendingRow && role !== "대기" && role !== "admin") {
              approve(role, e.target);
              return;
            }
            start(async () => {
              const r = await changeRole(profile.id, role);
              if (!r.ok) setErr(r.msg ?? "실패했습니다.");
            });
          }}
        >
          <option value="대기">대기(권한없음)</option>
          <option value="viewer">뷰어</option>
          <option value="editor">편집자</option>
          <option value="admin">관리자</option>
          <option value="tutor">과외선생님</option>
        </select>
        {err && <div className="text-xs text-red-600 mt-1 max-w-[16rem]">{err}</div>}
        {okMsg && <div className="text-xs text-emerald-600 mt-1">{okMsg}</div>}
      </td>
      <td className="py-2 pr-2 text-slate-500">
        {new Date(profile.created_at).toLocaleDateString("ko-KR")}
      </td>
      <td className="py-2 pr-2 text-right whitespace-nowrap">
        {approveAsTutor && !isMe && (
          <button
            className="btn-primary py-1 px-3 mr-2"
            disabled={pending || (!studentNo.trim() && !hasStudentNo)}
            title={!studentNo.trim() && !hasStudentNo ? "왼쪽에 학번을 먼저 붙여 넣어 주세요" : undefined}
            onClick={() => approve("tutor")}
          >
            학번 저장하고 과외선생님으로 승인
          </button>
        )}
        {!isMe && (
          <button
            className="btn-danger py-1 px-3"
            disabled={pending}
            onClick={() => {
              if (!confirm(`${personLabel(profile)} 계정을 삭제할까요? 로그인이 즉시 막힙니다.`)) return;
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

/** 승인된 계정의 학번: 평소에는 "저장됨/없음"만 보이고, 누를 때만 불러와서 보여 주고 고칠 수 있다(관리자 전용). */
function StudentNoControl({ userId, initiallySaved }: { userId: string; initiallySaved: boolean }) {
  const [saved, setSaved] = useState(initiallySaved);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  if (!open) {
    return (
      <div className="text-xs text-slate-400 mt-0.5">
        학번 {saved ? "저장됨" : "없음"} ·{" "}
        <button
          type="button"
          className="text-sky-700 hover:underline"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setMsg(null);
              if (!saved) {
                setValue("");
                setOpen(true);
                return;
              }
              const r = await revealStudentNo(userId);
              if (!r.ok) {
                setMsg({ ok: false, text: r.msg });
                return;
              }
              setValue(r.studentNo ?? "");
              setOpen(true);
            })
          }
        >
          {saved ? "보기·고치기" : "입력"}
        </button>
        {msg && <span className={msg.ok ? " text-emerald-600" : " text-red-600"}> {msg.text}</span>}
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="input py-0.5 px-1 w-36 text-xs font-mono"
        placeholder="학번 (비우면 지움)"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        aria-label="학번(학생증 번호)"
      />
      <button
        type="button"
        className="btn-secondary py-0.5 px-2 text-xs"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await setStudentNo(userId, value);
            if (!r.ok) {
              setMsg({ ok: false, text: r.msg });
              return;
            }
            setSaved(!!value.trim());
            setValue("");
            setOpen(false);
            setMsg({ ok: true, text: "저장했습니다" });
          })
        }
      >
        저장
      </button>
      <button
        type="button"
        className="text-slate-500 hover:underline"
        disabled={busy}
        onClick={() => {
          setValue("");
          setOpen(false);
          setMsg(null);
        }}
      >
        닫기
      </button>
      {msg && !msg.ok && <div className="w-full text-red-600">{msg.text}</div>}
    </div>
  );
}
