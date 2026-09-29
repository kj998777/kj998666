"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { callReviewApi } from "@/lib/tutor/reviewApi";

export default function ReleaseClaimButton({ itemExplanationId }: { itemExplanationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState("");
  if (!ask) {
    return (
      <button className="btn-secondary" disabled={pending} onClick={() => setAsk(true)}>
        포기
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            // 2026-09-29: 서버 액션 대신 고정 주소 — 사이트 업데이트 뒤에도 그대로 동작
            const r = await callReviewApi({ op: "release", itemExplanationId });
            if (!r.ok) {
              setErr(r.msg ?? "포기하지 못했습니다. 다시 눌러 주세요.");
              return;
            }
            try {
              localStorage.removeItem(`mc-review-draft:${itemExplanationId}`);
            } catch {
              /* 무시 */
            }
            router.refresh();
          })
        }
      >
        {pending ? "처리 중…" : "정말 포기"}
      </button>
      <button className="text-xs text-slate-500 underline" disabled={pending} onClick={() => setAsk(false)}>
        취소
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
