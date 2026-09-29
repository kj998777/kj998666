"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";

// 2026-09-29 원장님 요청: 원장님께 보내는 가입 정보에 학번(학생증 번호, 예: 2025XXXXXX)도 꼭 들어가게.
// 여기서 적은 학번은 이 화면의 복사 글에만 들어가고 DB에는 저장하지 않는다 — 원장님이 승인할 때
// 학생증 캡처와 맞춰 보고 계정 관리 화면에 붙여 넣어 저장한다(관리자만 볼 수 있음).
export default function PendingMessage({ head, tail, initialStudentNo = "" }: { head: string[]; tail: string[]; initialStudentNo?: string }) {
  const [no, setNo] = useState(initialStudentNo);
  const clean = no.replace(/\s+/g, "");
  const message = [...head, `학번(학생증 번호): ${clean || "(여기에 학번을 적어 주세요)"}`, ...tail].join("\n");
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div>
        <label htmlFor="pending-sno" className="block text-sm font-medium text-amber-900">
          ① 학번(학생증 번호)을 적고
        </label>
        <input
          id="pending-sno"
          className={"input mt-1 " + (clean ? "" : "border-amber-400")}
          inputMode="numeric"
          autoComplete="off"
          placeholder="예: 2025XXXXXX (25학번 말고 학생증에 적힌 번호 전체)"
          value={no}
          maxLength={30}
          onChange={(e) => setNo(e.target.value)}
        />
        <p className="text-xs text-amber-800 mt-1">학번은 재학생 확인용으로 원장님만 봅니다. 사이트 어디에도 표시되지 않습니다.</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-amber-900">② 이 내용을 복사해서</p>
        <CopyButton text={message} label="내용 복사" targetId="pending-msg" />
      </div>
      <pre id="pending-msg" className="whitespace-pre-wrap break-all rounded bg-white px-3 py-2 text-sm text-slate-800 border border-amber-200 font-sans">
        {message}
      </pre>
      {!clean && <p className="text-xs text-red-600">학번을 적지 않으면 승인할 수 없어요.</p>}
    </div>
  );
}
