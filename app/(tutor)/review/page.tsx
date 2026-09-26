"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimNextReviewItem } from "./actions";

// 검토 큐는 목록으로 보여주지 않고(블라인드 배정을 위해) "다음 문항 받기" 버튼 하나로 진입점만
// 제공한다. 배정된 문항은 /tutor/review/[itemId]?kind=primary|verify 로 이동해서 보여준다.
export default function ReviewQueuePage() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="card text-center space-y-3 max-w-lg mx-auto">
      <h1 className="text-lg font-semibold">검토하기</h1>
      <p className="text-sm text-slate-500">
        버튼을 누르면 검토가 필요한 문항 하나를 배정받습니다. 원본 문제지 PDF를 함께 보고 정답과
        풀이를 제출하면 즉시 반영되고 포인트가 적립됩니다.
      </p>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            try {
              const result = await claimNextReviewItem();
              if (!result) {
                setMsg("지금은 검토할 문항이 없습니다. 나중에 다시 확인해 주세요.");
                return;
              }
              router.push(`/tutor/review/${result.itemExplanationId}?kind=${result.kind}`);
            } catch (e: any) {
              setMsg(e?.message ?? "문항을 배정받지 못했습니다.");
            }
          })
        }
      >
        다음 문항 받기
      </button>
      {msg && <p className="text-sm text-slate-500">{msg}</p>}
    </div>
  );
}
