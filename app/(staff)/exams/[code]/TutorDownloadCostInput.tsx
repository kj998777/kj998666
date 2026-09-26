"use client";

import { useState, useTransition } from "react";
import { updateTutorDownloadCost } from "./actions";

// FolderSelect.tsx 와 같은 커밋-온-블러 패턴. 닫힘 상태 시험에서만 보인다(exams/[code]/page.tsx).
// 빈 값 = 과외선생님 스토어 판매 대상 아님.
export default function TutorDownloadCostInput({ code, cost }: { code: string; cost: number | null }) {
  const [value, setValue] = useState(cost != null ? String(cost) : "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function commit(raw: string) {
    setMsg("");
    const cleaned = raw.replace(/[^0-9]/g, "");
    setValue(cleaned);
    const next = cleaned ? Number(cleaned) : null;
    start(async () => {
      const r = await updateTutorDownloadCost(code, next);
      if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
    });
  }

  return (
    <div className="card flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">과외선생님 기출 다운로드 가격(포인트)</span>
      <input
        className="input py-1 text-sm"
        style={{ width: "6rem" }}
        placeholder="미판매"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={(e) => commit(e.target.value)}
      />
      <span className="text-xs text-slate-400">빈 값 = 스토어에 안 보임</span>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
