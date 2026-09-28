"use client";

import { useState, useTransition } from "react";
import { updateTutorDownloadCost } from "./actions";

// FolderSelect.tsx 와 같은 커밋-온-블러 패턴. #1: 열림 상태 시험에서만 보인다(exams/[code]/page.tsx)
// — 검토가 끝나 정답이 확정된 시험만 스토어에 등록 가능하다(서버 액션에도 같은 검사가 있음).
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
      <span className="text-xs text-slate-400">
        빈 값 = 스토어에 안 보임 · 검토가 끝나 시험이 열리면(수동 확정 또는 과외선생님 검토 완료 시
        자동) 3P로 판매가 자동 개시됩니다(여기서 비워두면 판매를 막을 수 있습니다)
      </span>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
