import "server-only";
import { isCorrect } from "@/lib/grading";
import { mcDigitOf } from "@/lib/ai/normalize";
import { openExamIfAllConfirmed, toKeyAnswer, tutorAnswerMatches } from "@/lib/review/confirm";
import { regradeExam } from "@/lib/review/regrade";

// 0037 검토 신뢰성(프로젝트 문서 claude/reliability-design.md) — 다수결 확정·정답률 기록.
//
// 표 셈법: AI(정답표) 1표 + 첫 선생님(A) 1표 + 판정 선생님(B) 1표. 2:1이면 자동 확정, 셋 다 다르면 원장님(review_stage='admin').
// "누가 맞았는지"가 정해질 때마다 tutor_judgments에 남기고, 그 정답률이 등급(tutor_trust_level)을 정한다.
// 모두 서비스롤 클라이언트로 부른다(과외선생님 세션은 정답표·다른 선생님 답을 읽을 수 없어야 하므로).

type Client = any;

/** 과외선생님이 "정답 없음/문제 오류"로 낸 답 */
export const ERROR_ANSWER = "문제 오류";
export function isErrorAnswer(s: unknown): boolean {
  return String(s ?? "").replace(/\s+/g, "") === "문제오류";
}

/** 두 선생님 답이 같은가(정답표 모양으로 바꿔서도 비교). "문제 오류"끼리는 같다고 본다. */
export function sameAnswer(type: string, a: string, b: string): boolean {
  if (!a || !b) return false;
  const ea = isErrorAnswer(a);
  const eb = isErrorAnswer(b);
  if (ea || eb) return ea && eb;
  const ka = keyFromTutor(type, a);
  const kb = keyFromTutor(type, b);
  return isCorrect(ka, kb, type) || isCorrect(a, b, type) || isCorrect(kb, ka, type);
}

/** 선생님 답이 정답표 칸(여러 정답은 |)과 맞는가 */
export function matchesKey(type: string, answer: string, keyCell: string): boolean {
  if (!answer || !keyCell || isErrorAnswer(answer)) return false;
  return tutorAnswerMatches(type, answer, keyCell) || isCorrect(keyFromTutor(type, answer), keyCell, type);
}

/** 선생님 답 → 정답표에 넣을 값. 객관식 여러 개(①③)는 "13", 하나는 "3". */
export function keyFromTutor(type: string, display: string): string {
  const raw = String(display ?? "");
  if (type === "객관식") {
    const circ: Record<string, string> = { "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5" };
    const digits = Array.from(raw)
      .map((ch) => circ[ch] ?? (/[1-5]/.test(ch) ? ch : ""))
      .filter(Boolean);
    const uniq = Array.from(new Set(digits)).sort();
    if (uniq.length) return uniq.join("");
    const d = mcDigitOf(raw);
    if (d) return d;
  }
  return toKeyAnswer(type, raw);
}

async function loadItemKey(admin: Client, itemId: string) {
  const { data: ie } = (await admin
    .from("item_explanations")
    .select("id, exam_id, item_label, answer_display, solution, review_confirmed, review_stage")
    .eq("id", itemId)
    .maybeSingle()) as any;
  if (!ie) return null;
  const { data: key } = (await admin
    .from("answer_key")
    .select("id, correct_answers, type")
    .eq("exam_id", ie.exam_id)
    .eq("item_label", ie.item_label)
    .maybeSingle()) as any;
  return { ie, key: key as { id: string; correct_answers: string; type: string } | null };
}

async function judge(admin: Client, rows: { tutor_id: string; review_id?: string; gold_attempt_id?: string; item_explanation_id: string; correct: boolean; source: string }[]) {
  const byReview = rows.filter((r) => r.review_id);
  const byGold = rows.filter((r) => r.gold_attempt_id);
  if (byReview.length) await (admin.from("tutor_judgments") as any).upsert(byReview, { onConflict: "review_id" });
  if (byGold.length) await (admin.from("tutor_judgments") as any).upsert(byGold, { onConflict: "gold_attempt_id" });
}

async function confirm(
  admin: Client,
  ie: any,
  source: "auto_match" | "majority",
  patch: Record<string, unknown> = {}
): Promise<boolean> {
  await (admin.from("item_explanations") as any)
    .update({
      ...patch,
      review_confirmed: true,
      review_confirm_source: source,
      review_confirmed_at: new Date().toISOString(),
      review_stage: null,
      tutor_reviewed: true,
      claimed_by: null,
      claim_expires_at: null,
    })
    .eq("id", ie.id)
    .eq("review_confirmed", false);
  // 다수결로 끝난 제출은 "과외 검토 분쟁" 목록에 남기지 않는다
  await (admin.from("tutor_item_reviews") as any).update({ resolved: true }).eq("item_explanation_id", ie.id).eq("kind", "primary");
  return openExamIfAllConfirmed(admin, ie.exam_id);
}

/**
 * 첫 제출 직후: 검증됨·우수 선생님 답이 정답표와 같으면 확정. 다르거나(다수결 판정 필요) 신규·주의 선생님이면
 * 두 번째 선생님 판정을 기다린다(review_stage='second').
 */
export async function afterPrimarySubmit(admin: Client, itemId: string, tutorId: string): Promise<{ examOpened: boolean }> {
  const loaded = await loadItemKey(admin, itemId);
  if (!loaded || loaded.ie.review_confirmed) return { examOpened: false };
  const { ie, key } = loaded;
  const { data: level } = await admin.rpc("tutor_trust_level", { p_tutor: tutorId });
  const lv = String(level || "ok");
  const matched = !!key && matchesKey(key.type, ie.answer_display, key.correct_answers);

  if (matched && (lv === "ok" || lv === "top")) {
    return { examOpened: await confirm(admin, ie, "auto_match") };
  }
  await (admin.from("item_explanations") as any).update({ review_stage: "second" }).eq("id", ie.id);
  const { data: prim } = (await admin
    .from("tutor_item_reviews")
    .select("id")
    .eq("item_explanation_id", ie.id)
    .eq("kind", "primary")
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as any;
  if (prim) {
    await (admin.from("tutor_item_reviews") as any)
      .update({ needs_verification: true, tiebreak: !matched })
      .eq("id", prim.id);
  }
  return { examOpened: false };
}

/**
 * 판정(두 번째 선생님) 제출 직후. 결과: confirmed(2:1 이상) · admin(셋 다 다름 → 원장님) · audit(이미 확정된 문항의 무작위 확인).
 */
export async function afterVerifySubmit(
  admin: Client,
  itemId: string,
  primaryReviewId: string,
  verifyReviewId: string
): Promise<{ outcome: "confirmed" | "admin" | "audit"; examOpened: boolean }> {
  const loaded = await loadItemKey(admin, itemId);
  const { data: revs } = (await admin
    .from("tutor_item_reviews")
    .select("id, tutor_id, answer_display, solution")
    .in("id", [primaryReviewId, verifyReviewId])) as any;
  const A = ((revs as any[]) ?? []).find((r) => r.id === primaryReviewId);
  const B = ((revs as any[]) ?? []).find((r) => r.id === verifyReviewId);
  if (!loaded || !A || !B) return { outcome: "admin", examOpened: false };
  const { ie, key } = loaded;
  const type = key?.type ?? "주관식";
  const K = key?.correct_answers ?? "";
  const j = (r: any, correct: boolean, source = "majority") => ({
    tutor_id: r.tutor_id,
    review_id: r.id,
    item_explanation_id: ie.id,
    correct,
    source,
  });
  const regradeIfChanged = async (next: string) => {
    if (!key || next === key.correct_answers) return;
    await (admin.from("answer_key") as any).update({ correct_answers: next }).eq("id", key.id);
    await regradeExam(admin, ie.exam_id);
  };

  // 이미 확정된 문항(무작위 확인): 확정 답 + 확정에 찬성한 쪽이 다수 — 확정 답과 다르면 B만 틀린 것으로
  if (ie.review_confirmed) {
    const bOk = matchesKey(type, B.answer_display, K);
    const aOk = matchesKey(type, A.answer_display, K);
    await judge(admin, [j(B, bOk), j(A, aOk)]);
    await (admin.from("tutor_item_reviews") as any).update({ resolved: true }).eq("id", A.id);
    return { outcome: "audit", examOpened: false };
  }

  const aK = !!K && matchesKey(type, A.answer_display, K);
  const bK = !!K && matchesKey(type, B.answer_display, K);
  const bA = sameAnswer(type, A.answer_display, B.answer_display);

  // 둘 다 "문제 오류"거나 정답표 줄이 없으면 원장님이 정한다
  const bothError = isErrorAnswer(A.answer_display) && isErrorAnswer(B.answer_display);
  if (!key || bothError) {
    await (admin.from("item_explanations") as any).update({ review_stage: "admin" }).eq("id", ie.id);
    return { outcome: "admin", examOpened: false };
  }

  if (aK) {
    // A와 AI가 같은데(신규·주의 선생님이라 확인 중) → B가 같으면 셋 다, 다르면 2:1로 A·AI
    await judge(admin, [j(A, true), j(B, bA)]);
    return { outcome: "confirmed", examOpened: await confirm(admin, ie, "majority") };
  }
  if (bA) {
    // A·B가 같고 AI만 다름 → 선생님 답으로 정답표를 바꾸고 다시 채점
    await regradeIfChanged(keyFromTutor(type, A.answer_display));
    await judge(admin, [j(A, true), j(B, true)]);
    return { outcome: "confirmed", examOpened: await confirm(admin, ie, "majority") };
  }
  if (bK) {
    // B·AI가 같고 A만 다름 → 정답표 그대로, 해설은 B의 것으로
    await judge(admin, [j(A, false), j(B, true)]);
    return {
      outcome: "confirmed",
      examOpened: await confirm(admin, ie, "majority", {
        answer_display: B.answer_display,
        solution: B.solution || ie.solution,
        updated_at: new Date().toISOString(),
      }),
    };
  }
  await (admin.from("item_explanations") as any).update({ review_stage: "admin" }).eq("id", ie.id);
  return { outcome: "admin", examOpened: false };
}

/** 원장님 확정·이의제기 채택 뒤: 그 문항의 모든 선생님 제출을 최종 정답과 비교해 기록(덮어씀). */
export async function judgeItemReviews(admin: Client, itemId: string, source: "admin" | "dispute"): Promise<void> {
  const loaded = await loadItemKey(admin, itemId);
  if (!loaded?.key) return;
  const { ie, key } = loaded;
  const { data: revs } = (await admin
    .from("tutor_item_reviews")
    .select("id, tutor_id, answer_display")
    .eq("item_explanation_id", ie.id)) as any;
  const rows = ((revs as any[]) ?? []).map((r) => ({
    tutor_id: r.tutor_id,
    review_id: r.id,
    item_explanation_id: ie.id,
    correct: matchesKey(key.type, r.answer_display, key.correct_answers),
    source,
  }));
  if (rows.length) await judge(admin, rows);
  await (admin.from("item_explanations") as any).update({ review_stage: null }).eq("id", ie.id);
  await (admin.from("tutor_item_reviews") as any).update({ resolved: true }).eq("item_explanation_id", ie.id).eq("kind", "primary");
}

/** 정답 아는 문항 채점(정답표와 비교) → 기록 */
export async function gradeGoldAttempt(admin: Client, attemptId: string): Promise<boolean | null> {
  const { data: g } = (await admin
    .from("tutor_gold_attempts")
    .select("id, tutor_id, item_explanation_id, exam_id, item_label, answer_display")
    .eq("id", attemptId)
    .maybeSingle()) as any;
  if (!g) return null;
  const { data: key } = (await admin
    .from("answer_key")
    .select("correct_answers, type")
    .eq("exam_id", g.exam_id)
    .eq("item_label", g.item_label)
    .maybeSingle()) as any;
  if (!key) return null;
  const correct = matchesKey(key.type, g.answer_display, key.correct_answers);
  await (admin.from("tutor_gold_attempts") as any).update({ correct }).eq("id", g.id);
  await judge(admin, [{ tutor_id: g.tutor_id, gold_attempt_id: g.id, item_explanation_id: g.item_explanation_id, correct, source: "gold" }]);
  return correct;
}

/** 이 선생님에게 지금 배정된 정답 아는 문항(없으면 null) */
export async function activeGoldAttempt(admin: Client, tutorId: string, itemId: string): Promise<{ id: string } | null> {
  const { data } = (await admin
    .from("tutor_gold_attempts")
    .select("id")
    .eq("tutor_id", tutorId)
    .eq("item_explanation_id", itemId)
    .is("submitted_at", null)
    .eq("released", false)
    .gt("claim_expires_at", new Date().toISOString())
    .maybeSingle()) as any;
  return data ?? null;
}
