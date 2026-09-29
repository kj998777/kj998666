"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCorrect } from "@/lib/grading";
import { autoConfirmIfMatch } from "@/lib/review/confirm";

const PHOTO_BUCKET = "tutor-review-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB
// 2026-09-29 원장님 요청: 풀이 없이 정답만 내는 제출을 막는다 — 풀이 글(이 글자 수 이상) 또는 풀이 사진 중 하나는 있어야 한다.
// (제출 화면 SubmissionForm.tsx의 MIN_SOLUTION_CHARS와 같은 값)
const MIN_SOLUTION_CHARS = 10;

function missingSolution(solution: string, image?: File | null): boolean {
  const hasImage = !!image && typeof (image as any).size === "number" && (image as File).size > 0;
  return solution.trim().length < MIN_SOLUTION_CHARS && !hasImage;
}
const SOLUTION_REQUIRED_MSG = `풀이를 ${MIN_SOLUTION_CHARS}자 이상 적거나 풀이 사진을 올려 주세요. 풀이가 있어야 제출할 수 있습니다.`;

/**
 * 제출 폼에서 올린 사진(선택)을 tutor-review-photos 버킷에 저장하고 경로를 돌려준다.
 * AI 디지털화는 하지 않는다 — 사진은 원본 그대로 저장해서 나중에 관리자가 눈으로 확인할 때만 쓴다.
 * 사진이 없으면(image가 없거나 빈 파일) null을 돌려준다.
 */
async function uploadReviewPhoto(itemExplanationId: string, image: File | null | undefined): Promise<string | null> {
  if (!image || image.size === 0) return null;
  if (!image.type.startsWith("image/")) {
    throw new Error("이미지 파일만 올릴 수 있습니다.");
  }
  if (image.size > MAX_PHOTO_BYTES) {
    throw new Error("사진 용량이 너무 큽니다(10MB 이하로 올려 주세요).");
  }
  const ext = (image.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  const path = `${itemExplanationId}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await image.arrayBuffer());

  const admin = createAdminClient();
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: image.type,
    upsert: false,
  });
  if (error) throw new Error("사진 업로드에 실패했습니다: " + error.message);
  return path;
}

/**
 * 다음 검토 문항(새 문항 또는 사후 검증 대상)을 하나 배정받는다. 큐가 비어 있으면 null.
 * 배정이 거절되면(예: 신뢰도 "정지", 0025) { error: 안내 문구 }. 서버 액션에서 throw한 오류 문구는 운영 환경에서
 * 화면에 그대로 전달되지 않으므로 값으로 돌려준다.
 */
export async function claimNextReviewItem(): Promise<
  { itemExplanationId: string; kind: "primary" | "verify" } | { error: string } | null
> {
  const session = await requireTutor();
  // 2026-09-29: 이미 맡고 있는 문항이 있으면(다른 앱에 갔다 와서 화면이 새로 열린 경우 등) 새로 배정하지 않고 그 문항으로
  // 돌려보낸다 — 전에는 새 문항이 또 배정돼 앞 문항이 30분 동안 아무도 못 푸는 채로 묶였다. 다른 문항을 원하면 "포기"를 누르면 된다.
  try {
    const { getMyActiveClaims } = await import("@/lib/tutor/claims");
    const mine = await getMyActiveClaims(session.userId);
    if (mine.length) return { itemExplanationId: mine[0].itemExplanationId, kind: mine[0].kind };
  } catch {
    /* 확인 실패는 무시하고 평소대로 배정 */
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_next_review_item");
  if (error) return { error: error.message || "문항을 배정받지 못했습니다." };
  return data ?? null;
}

/** 지금 배정받은 문항을 포기하고 나중에 다른 문항을 받는다. */
export async function releaseReviewClaim(itemExplanationId: string) {
  await requireTutor();
  const supabase = await createClient();
  await (supabase.rpc as any)("release_review_claim", { p_item_explanation_id: itemExplanationId });
  revalidatePath("/tutor/review");
}

/** 최초 제출(primary) — 즉시 반영 + 즉시 적립. image는 풀이를 찍은 사진(선택, 디지털화하지 않음). */
export async function submitPrimaryReview(
  itemExplanationId: string,
  answerDisplay: string,
  solution: string,
  image?: File | null
) {
  await requireTutor();
  if (!answerDisplay.trim()) return { ok: false, msg: "정답을 입력해 주세요." };
  if (missingSolution(solution, image)) return { ok: false, msg: SOLUTION_REQUIRED_MSG };

  let imagePath: string | null = null;
  try {
    imagePath = await uploadReviewPhoto(itemExplanationId, image);
  } catch (e: any) {
    return { ok: false, msg: e?.message || "사진 업로드에 실패했습니다." };
  }

  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("submit_tutor_review", {
    p_item_explanation_id: itemExplanationId,
    p_answer_display: answerDisplay.trim(),
    p_solution: solution.trim(),
    p_image_path: imagePath,
  });
  if (error) return { ok: false, msg: error.message };

  // #3: 제출된 답이 정답표와 같으면 자동 확정 → 시험의 모든 문항이 확정되면 자동으로 연다.
  // 과외선생님 세션으로는 시험 상태를 바꿀 수 없으므로(관리자 전용 트리거) 서비스롤로 처리한다.
  // 여기서 실패해도 제출 자체는 이미 끝났으므로 오류를 삼키고(관리자가 검토현황에서 확정 가능) 계속 진행.
  let examOpened = false;
  try {
    const r = await autoConfirmIfMatch(createAdminClient(), itemExplanationId);
    examOpened = r.examOpened;
  } catch (e) {
    console.error("autoConfirmIfMatch failed", e);
  }

  revalidatePath("/tutor/dashboard");
  revalidatePath("/admin/review-status");
  return { ok: true, pointsEarned: data?.pointsEarned ?? 0, examOpened };
}

/**
 * 사후 검증 제출. 일치 여부는 여기(서버 액션)에서 lib/grading.ts로 계산한다 — 검증하는 과외선생님의
 * 세션 클라이언트는 RLS상 원 제출자의 답을 직접 읽을 수 없으므로(의도적 — 블라인드 검증), 비교에
 * 필요한 순간에만 서비스롤 클라이언트로 원 제출을 조회하고, 결과(참/거짓)만 클라이언트로 돌려준다.
 */
export async function submitVerification(
  itemExplanationId: string,
  answerDisplay: string,
  solution: string,
  image?: File | null
) {
  await requireTutor();
  if (!answerDisplay.trim()) return { ok: false, msg: "정답을 입력해 주세요." };
  if (missingSolution(solution, image)) return { ok: false, msg: SOLUTION_REQUIRED_MSG };

  let imagePath: string | null = null;
  try {
    imagePath = await uploadReviewPhoto(itemExplanationId, image);
  } catch (e: any) {
    return { ok: false, msg: e?.message || "사진 업로드에 실패했습니다." };
  }

  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("submit_tutor_verification", {
    p_item_explanation_id: itemExplanationId,
    p_answer_display: answerDisplay.trim(),
    p_solution: solution.trim(),
    p_image_path: imagePath,
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
