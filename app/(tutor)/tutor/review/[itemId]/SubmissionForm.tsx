"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPrimaryReview, submitVerification, releaseReviewClaim } from "../actions";

// 새 문항(primary)과 사후 검증(verify) 제출을 같은 폼으로 처리한다 — 화면도, 입력 방식도 완전히
// 동일해야 검증자가 "이건 검증용이구나"를 눈치채지 못한다(블라인드 검증의 핵심).
export default function SubmissionForm({
  itemExplanationId,
  kind,
}: {
  itemExplanationId: string;
  kind: "primary" | "verify";
}) {
  const router = useRouter();
  const [answerDisplay, setAnswerDisplay] = useState("");
  const [solution, setSolution] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ pointsEarned: number; isMatch?: boolean } | null>(null);

  if (result) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-emerald-600 font-medium">제출 완료! +{result.pointsEarned}P 적립됐습니다.</p>
        {kind === "verify" && (
          <p className="text-sm text-slate-500">
            {result.isMatch
              ? "원 제출과 일치했습니다."
              : "원 제출과 일치하지 않아 관리자 확인이 필요합니다."}
          </p>
        )}
        <button className="btn-primary" onClick={() => router.push("/tutor/review")}>
          다음 문항 받기
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div>
        <label className="label">정답</label>
        <input
          className="input"
          value={answerDisplay}
          onChange={(e) => setAnswerDisplay(e.target.value)}
          placeholder="예: 3 또는 12.5 또는 3/4"
        />
      </div>
      <div>
        <label className="label">풀이 (선택)</label>
        <textarea
          className="input min-h-32"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이 과정을 적어 주세요."
        />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending || !answerDisplay.trim()}
          onClick={() =>
            start(async () => {
              setErr("");
              const r =
                kind === "verify"
                  ? await submitVerification(itemExplanationId, answerDisplay, solution)
                  : await submitPrimaryReview(itemExplanationId, answerDisplay, solution);
              if (!r.ok) {
                setErr(r.msg ?? "제출하지 못했습니다.");
                return;
              }
              setResult({
                pointsEarned: r.pointsEarned,
                isMatch: "isMatch" in r ? (r as { isMatch: boolean }).isMatch : undefined,
              });
            })
          }
        >
          제출
        </button>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await releaseReviewClaim(itemExplanationId);
              router.push("/tutor/review");
            })
          }
        >
          포기하고 다른 문항 받기
        </button>
      </div>
    </div>
  );
}
