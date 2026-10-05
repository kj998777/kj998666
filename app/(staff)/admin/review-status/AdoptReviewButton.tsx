"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adoptTutorReview } from "./actions";

/**
 * 2026-10-05 과외선생님 제출 하나의 답·풀이로 정답표·해설을 바꾸고 확정(adoptTutorReview). 한 번 더 눌러야 실행된다.
 * 검토현황 문항 화면(과외선생님 제출 목록)과 과외 검토 분쟁 화면에서 쓴다.
 */
export default function AdoptReviewButton({ reviewId, label = "이 답·풀이로 확정" }: { reviewId: string; label?: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (msg?.ok) return <p className="text-xs text-emerald-700">{msg.text}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!asking ? (
        <button type="button" className="btn-secondary py-1 px-2.5 text-xs" onClick={() => setAsking(true)}>
          {label}
        </button>
      ) : (
        <>
          <span className="text-xs text-slate-600">정답표·정답 표시·풀이를 이 제출로 바꾸고 확정합니다(정답이 바뀌면 다시 채점).</span>
          <button
            type="button"
            className="btn-primary py-1 px-2.5 text-xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await adoptTutorReview(reviewId);
                if (!r.ok) {
                  setMsg({ ok: false, text: r.msg ?? "실패했습니다." });
                  setAsking(false);
                  return;
                }
                setMsg({
                  ok: true,
                  text:
                    "확정했습니다." +
                    (r.regraded ? ` 제출 ${r.regraded}건을 다시 채점했습니다.` : "") +
                    (r.keptSolution ? " 이 제출에 풀이 글이 없어(사진만) 풀이는 그대로 두었습니다 — 문항 화면에서 직접 고쳐 주세요." : "") +
                    (r.examOpened ? " 모든 문항이 확정되어 시험이 열렸습니다." : ""),
                });
                router.refresh();
              })
            }
          >
            {pending ? "바꾸는 중…" : "바꾸고 확정"}
          </button>
          <button type="button" className="btn-secondary py-1 px-2.5 text-xs" disabled={pending} onClick={() => setAsking(false)}>
            취소
          </button>
        </>
      )}
      {msg && !msg.ok && <span className="text-xs text-red-600">{msg.text}</span>}
    </div>
  );
}
