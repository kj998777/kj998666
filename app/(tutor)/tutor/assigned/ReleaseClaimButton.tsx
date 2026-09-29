"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { releaseReviewClaim } from "../review/actions";

export default function ReleaseClaimButton({ itemExplanationId }: { itemExplanationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
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
            await releaseReviewClaim(itemExplanationId);
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
    </span>
  );
}
