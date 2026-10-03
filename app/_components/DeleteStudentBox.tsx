"use client";

// 2026-10-03 원장님: "학생 삭제 기능도 추가". 학생이 낸 제출을 모두 지우는 상자 — 되돌릴 수 없으므로
// 학생 이름을 그대로 다시 입력해야 버튼이 눌린다. 원장님 학생 화면(관리자만)과 과외선생님 "내 학생"이 같이 쓴다.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function DeleteStudentBox({
  name,
  nSubs,
  action,
  backHref,
  note,
}: {
  name: string;
  nSubs: number;
  /** 서버 액션(학생 키를 묶어서 넘김) */
  action: () => Promise<{ ok: boolean; msg?: string; n?: number }>;
  backHref: string;
  note?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const match = typed.trim() === name.trim();

  if (!open)
    return (
      <button type="button" className="text-sm text-slate-400 hover:text-red-600" onClick={() => setOpen(true)}>
        학생 삭제…
      </button>
    );

  return (
    <div className="card border-red-200 bg-red-50/60 space-y-2">
      <h2 className="font-medium text-red-800">학생 삭제</h2>
      <p className="text-sm text-red-900">
        <b>{name}</b> 학생이 낸 시험 제출 {nSubs}건과 채점 결과를 모두 지웁니다. 반 평균·종합 보고서·학생 분석에서도 빠지고 <b>되돌릴 수 없습니다</b>.
        {note ? ` ${note}` : ""}
      </p>
      {!note && <p className="text-xs text-slate-600">기록은 남기고 목록에서만 감추려면 삭제 대신 위쪽의 &ldquo;목록에서 숨기기&rdquo;를 쓰세요.</p>}
      <label className="block text-sm">
        확인을 위해 학생 이름 <b>{name}</b> 을(를) 그대로 입력해 주세요.
        <input className="input mt-1 max-w-xs block" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-danger"
          disabled={!match || pending}
          onClick={() =>
            start(async () => {
              setMsg("");
              const r = await action();
              if (!r.ok) {
                setMsg("실패: " + (r.msg || "삭제하지 못했습니다."));
                return;
              }
              router.replace(backHref);
              router.refresh();
            })
          }
        >
          {pending ? "지우는 중…" : `제출 ${nSubs}건 모두 삭제`}
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => { setOpen(false); setTyped(""); setMsg(""); }}>
          취소
        </button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </div>
  );
}
