"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purchaseExam } from "./actions";

export default function PurchaseButton({ examId, cost }: { examId: string; cost: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  return (
    <div className="flex items-center gap-2">
      <button
        className="btn-primary py-1 px-3"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await purchaseExam(examId);
            if (!r.ok) {
              setErr(r.msg ?? "구매하지 못했습니다.");
              return;
            }
            // revalidatePath만으로는 이미 렌더된 서버 컴포넌트가 바로 갱신되지 않으므로, 여기서
            // 한 번 더 새로고침해 구매 버튼 → 다운로드 링크로 즉시 바뀌게 한다.
            router.refresh();
          })
        }
      >
        {cost}P로 구매
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
