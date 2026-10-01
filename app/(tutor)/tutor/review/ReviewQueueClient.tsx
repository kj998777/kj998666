"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { callReviewApi } from "@/lib/tutor/reviewApi";

// 검토 큐는 목록으로 보여주지 않고(블라인드 배정을 위해) "다음 문항 받기" 버튼 하나로 진입점만
// 제공한다. 배정된 문항은 /tutor/review/[itemId]?kind=primary|verify 로 이동해서 보여준다.
export default function ReviewQueueClient({ bonusLeft = 0 }: { bonusLeft?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="card text-center space-y-3 max-w-lg mx-auto">
      <h1 className="text-lg font-semibold">검토하기</h1>
      <p className="text-sm text-slate-500">
        버튼을 누르면 검토가 필요한 문항 하나를 배정받습니다. 원본 문제지 PDF를 함께 보고 정답과
        풀이를 제출하면 즉시 반영되고 포인트가 적립됩니다(난이도 하·중하·중 1P, 중상·상 2P).
      </p>
      {/* 0043: 처음 3문항 보너스 + 처음에는 쉬운 문항부터(DB award_review_points·tutor_prefers_easy) */}
      {bonusLeft > 0 && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          처음 3문항은 문항마다 <b>+1P를 더</b> 드려요 (보너스 {bonusLeft}문항 남음). 처음에는 비교적 쉬운 문항부터 나옵니다.
        </p>
      )}
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            try {
              // 2026-09-29: 서버 액션 대신 고정 주소 — 사이트 업데이트 뒤에도 그대로 동작
              const r = await callReviewApi({ op: "next" });
              if (!r.ok) {
                setMsg(r.msg ?? "문항을 배정받지 못했습니다.");
                return;
              }
              const result = r.next;
              if (!result) {
                setMsg("지금은 검토할 문항이 없습니다. 나중에 다시 확인해 주세요.");
                return;
              }
              if ("error" in result) {
                setMsg(result.error);
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
