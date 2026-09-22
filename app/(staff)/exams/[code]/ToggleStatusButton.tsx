"use client";

import { useState, useTransition } from "react";
import { toggleExamStatus } from "./actions";

export default function ToggleStatusButton({ code, open, hasKey }: { code: string; open: boolean; hasKey: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="text-right">
      <button
        className={open ? "btn-secondary" : "btn-primary"}
        disabled={pending || (!open && !hasKey)}
        title={!open && !hasKey ? "정답을 먼저 등록해야 열 수 있습니다." : undefined}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await toggleExamStatus(code, !open);
            if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
          })
        }
      >
        {pending ? "처리 중…" : open ? "제출 닫기" : "제출 열기"}
      </button>
      {msg && <div className="text-xs text-red-600 mt-1">{msg}</div>}
    </div>
  );
}
