"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purchaseExam } from "./actions";

export default function PurchaseButton({ examId, examCode, cost }: { examId: string; examCode: string; cost: number }) {
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
            // #4: 구매하면 바로 그 시험의 관리 화면(다운로드 / 제출 학생·보고서 / 수정 요청)으로 이동한다.
            router.push(`/tutor/store/${encodeURIComponent(examCode)}`);
          })
        }
      >
        {cost}P로 구매
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
