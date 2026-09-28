import "server-only";
import { isCorrect } from "@/lib/grading";
import { mcDigitOf, shortAnswerOf } from "@/lib/ai/normalize";

// #3 (2026-09-28): 문항별 "정답 확정"과 시험 자동 열기. 자세한 배경은
// supabase/migrations/0016_review_status_confirm.sql 머리말 참고.
//
// - 과외선생님 제출 직후(app/(tutor)/tutor/review/actions.ts)에는 서비스롤 클라이언트로,
//   관리자 검토현황 화면(app/(staff)/admin/review-status/actions.ts)에서는 관리자 세션으로 호출한다.
// - 시험 상태 변경 트리거(enforce_exam_status_change_admin_only)는 관리자 또는 서비스롤(auth.uid()가
//   없어 is_admin()이 NULL → 통과)만 허용한다. 과외선생님 세션으로는 절대 시험을 열 수 없으므로
//   (0014가 그래서 마지막 제출을 실패시킬 위험이 있었음) 과외선생님 경로는 반드시 서비스롤을 쓴다.

type Client = any;

/**
 * 과외선생님이 적은 정답 표시(①, "$\\frac{1}{2}$", "x=3" 등)를 정답표(answer_key.correct_answers)
 * 비교·저장용 문자열로 바꾼다. 완벽한 변환은 아니며, 못 맞추면 관리자가 검토현황에서 직접 고친다.
 */
export function toKeyAnswer(type: string, s: string): string {
  const raw = String(s ?? "");
  if (type === "객관식") {
    const d = mcDigitOf(raw);
    if (d) return d;
  }
  let t = shortAnswerOf(raw);
  const simple = (x: string) => /^-?[0-9a-zA-Z.]+$/.test(x);
  t = t
    .replace(/\\left|\\right/g, "")
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a, b) =>
      simple(a) && simple(b) ? `${a}/${b}` : `(${a})/(${b})`
    )
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\pi/g, "π")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\[,;!]|\\ /g, "")
    .replace(/[{}]/g, "");
  return t.trim().slice(0, 100);
}

/** 과외선생님 답(정답 표시)이 정답표와 같은가. */
export function tutorAnswerMatches(type: string, tutorAnswer: string, keyCell: string): boolean {
  if (!tutorAnswer || !keyCell) return false;
  return isCorrect(toKeyAnswer(type, tutorAnswer), keyCell) || isCorrect(tutorAnswer, keyCell);
}

/**
 * 시험의 모든 문항이 확정됐으면 검수대기 시험을 연다. 연 경우 true.
 * (열림으로 바뀌면 0014의 auto_set_tutor_download_cost 트리거가 스토어 가격도 자동으로 매긴다.)
 */
export async function openExamIfAllConfirmed(client: Client, examId: string): Promise<boolean> {
  const { count: total } = await client
    .from("item_explanations")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  if (!total) return false;
  const { count: left, error: cErr } = await client
    .from("item_explanations")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId)
    .eq("review_confirmed", false);
  if (cErr || left === null || left > 0) return false;

  const { data, error } = await (client.from("exams") as any)
    .update({ status: "열림" })
    .eq("id", examId)
    .eq("status", "검수대기")
    .select("id");
  if (error || !data?.length) return false;

  await (client.from("exam_jobs") as any)
    .update({
      stage: "done",
      message: "모든 문항의 정답이 확정되어 자동으로 시험을 열었습니다.",
      updated_at: new Date().toISOString(),
    })
    .eq("exam_id", examId)
    .eq("stage", "review");
  return true;
}

/**
 * 과외선생님 최초 제출 직후 호출 — 제출된 답이 정답표와 같으면 그 문항을 자동 확정하고,
 * 그 결과 시험의 모든 문항이 확정되면 시험을 연다. 다르면 아무것도 하지 않는다(관리자 검토현황에
 * "AI와 다름"으로 뜸).
 */
export async function autoConfirmIfMatch(
  client: Client,
  itemExplanationId: string
): Promise<{ matched: boolean; examOpened: boolean }> {
  const { data: ie } = (await client
    .from("item_explanations")
    .select("id, exam_id, item_label, answer_display, review_confirmed")
    .eq("id", itemExplanationId)
    .maybeSingle()) as any;
  if (!ie || ie.review_confirmed) return { matched: false, examOpened: false };

  const { data: key } = (await client
    .from("answer_key")
    .select("correct_answers, type")
    .eq("exam_id", ie.exam_id)
    .eq("item_label", ie.item_label)
    .maybeSingle()) as any;
  if (!key || !tutorAnswerMatches(key.type, ie.answer_display, key.correct_answers)) {
    return { matched: false, examOpened: false };
  }

  const { error } = await (client.from("item_explanations") as any)
    .update({
      review_confirmed: true,
      review_confirm_source: "auto_match",
      review_confirmed_at: new Date().toISOString(),
    })
    .eq("id", itemExplanationId)
    .eq("review_confirmed", false);
  if (error) return { matched: true, examOpened: false };

  const examOpened = await openExamIfAllConfirmed(client, ie.exam_id);
  return { matched: true, examOpened };
}
