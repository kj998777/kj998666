"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCorrect } from "@/lib/grading";

/** 다음 검토 문항(새 문항 또는 사후 검증 대상)을 하나 배정받는다. 큐가 비어 있으면 null. */
export async function claimNextReviewItem(): Promise<{ itemExplanationId: string; kind: "primary" | "verify" } | null> {
  await requireTutor();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_next_review_item");
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** 지금 배정받은 문항을 포기하고 나중에 다른 문항을 받는다. */
export async function releaseReviewClaim(itemExplanationId: string) {
  await requireTutor();
  const supabase = await createClient();
  await (supabase.rpc as any)("release_review_claim", { p_item_explanation_id: itemExplanationId });
  revalidatePath("/tutor/review");
}

/** 최초 제출(primary) — 즉시 반영 + 즉시 적립. */
export async function submitPrimaryReview(itemExplanationId: string, answerDisplay: string, solution: string) {
  await requireTutor();
  if (!answerDisplay.trim()) return { ok: false, msg: "정답을 입력해 주세요." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_tutor_review", {
    p_item_explanation_id: itemExplanationId,
    p_answer_display: answerDisplay.trim(),
    p_solution: solution.trim(),
  });
  if (error) return { ok: false, msg: error.message };

  revalidatePath("/tutor/dashboard");
  return { ok: true, pointsEarned: data?.pointsEarned ?? 0 };
}

/**
 * 사후 검증 제출. 일치 여부는 여기(서버 액션)에서 lib/grading.ts로 계산한다 — 검증하는 과외선생님의
 * 세션 클라이언트는 RLS상 원 제출자의 답을 직접 읽을 수 없으므로(의도적 — 블라인드 검증), 비교에
 * 필요한 순간에만 서비스롤 클라이언트로 원 제출을 조회하고, 결과(참/거짓)만 클라이언트로 돌려준다.
 */
export async function submitVerification(itemExplanationId: string, answerDisplay: string, solution: string) {
  await requireTutor();
  if (!answerDisplay.trim()) return { ok: false, msg: "정답을 입력해 주세요." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_tutor_verification", {
    p_item_explanation_id: itemExplanationId,
    p_answer_display: answerDisplay.trim(),
    p_solution: solution.trim(),
  });
  if (error) return { ok: false, msg: error.message };

  const { primaryReviewId, verifyReviewId, pointsEarned } = data;

  let isMatch = false;
  if (primaryReviewId && verifyReviewId) {
    const admin = createAdminClient();
    const { data: primary } = await admin
      .from("tutor_item_reviews")
      .select("answer_display")
      .eq("id", primaryReviewId)
      .maybeSingle();
    isMatch = isCorrect(answerDisplay.trim(), primary?.answer_display ?? "");
    await (supabase.rpc as any)("resolve_tutor_verification", {
      p_verify_review_id: verifyReviewId,
      p_is_match: isMatch,
    });
  }

  revalidatePath("/tutor/dashboard");
  return { ok: true, pointsEarned, isMatch };
}
