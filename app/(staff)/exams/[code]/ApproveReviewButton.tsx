"use client";

import { useState, useTransition } from "react";
import { approveAiReview } from "../ai-actions";

export default function ApproveReviewButton({ code }: { code: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await approveAiReview(code);
            if (!r.ok) setMsg(r.msg ?? "확정하지 못했습니다.");
          })
        }
      >
        {pending ? "확정하는 중…" : "정답 확인 완료 — 시험 열기"}
      </button>
      {msg && <p className="text-sm text-red-600 mt-1">{msg}</p>}
    </div>
  );
}
