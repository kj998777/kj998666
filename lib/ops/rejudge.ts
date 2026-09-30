import "server-only";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { matchesKey } from "@/lib/review/majority";
import { planRejudge, type AnswerOf, type JudgmentRow, type RejudgePlan } from "@/lib/ops/rejudgePlan";

// 정답률 기록 다시 맞추기(운영 현황 버튼). 서비스롤 클라이언트로 부른다. 계획은 lib/ops/rejudgePlan.ts.

type Client = any;

export async function rejudgeJudgments(admin: Client, apply: boolean): Promise<{ ok: boolean; msg?: string; plan?: RejudgePlan }> {
  const { data: jRaw, error } = await fetchAllPages((a, b) =>
    admin.from("tutor_judgments").select("id, tutor_id, correct, source, review_id, gold_attempt_id").eq("correct", false).order("id").range(a, b)
  );
  if (error) return { ok: false, msg: "정답률 기록을 읽지 못했습니다(0037 마이그레이션 확인): " + (error.message ?? error) };
  const rows: JudgmentRow[] = ((jRaw as any[]) ?? []).map((j) => ({
    id: j.id,
    tutorId: j.tutor_id,
    correct: !!j.correct,
    source: j.source,
    kind: j.review_id ? "review" : "gold",
    refId: j.review_id ?? j.gold_attempt_id,
  }));
  if (!rows.length) return { ok: true, plan: { checked: 0, flips: [], skippedUnconfirmed: 0, byTutor: {} } };

  const reviewIds = rows.filter((r) => r.kind === "review").map((r) => r.refId);
  const goldIds = rows.filter((r) => r.kind === "gold").map((r) => r.refId);
  const [revRes, goldRes] = await Promise.all([
    fetchAllIn(reviewIds, (ids, a, b) =>
      admin.from("tutor_item_reviews").select("id, item_explanation_id, answer_display").in("id", ids).order("id").range(a, b)
    ),
    fetchAllIn(goldIds, (ids, a, b) =>
      admin.from("tutor_gold_attempts").select("id, exam_id, item_label, answer_display").in("id", ids).order("id").range(a, b)
    ),
  ]);
  const revById = new Map(((revRes.data as any[]) ?? []).map((r) => [r.id, r]));
  const goldById = new Map(((goldRes.data as any[]) ?? []).map((g) => [g.id, g]));

  const itemIds = Array.from(revById.values()).map((r: any) => r.item_explanation_id);
  const { data: ieRaw } = await fetchAllIn(itemIds, (ids, a, b) =>
    admin.from("item_explanations").select("id, exam_id, item_label, review_confirmed").in("id", ids).order("id").range(a, b)
  );
  const ieById = new Map(((ieRaw as any[]) ?? []).map((x) => [x.id, x]));

  const examIds = [
    ...Array.from(ieById.values()).map((x: any) => x.exam_id),
    ...Array.from(goldById.values()).map((g: any) => g.exam_id),
  ];
  const { data: keyRaw } = await fetchAllIn(examIds, (ids, a, b) =>
    admin.from("answer_key").select("id, exam_id, item_label, correct_answers, type").in("exam_id", ids).order("id").range(a, b)
  );
  const keyOf = new Map(((keyRaw as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));

  const lookup = (r: JudgmentRow): AnswerOf | null => {
    if (r.kind === "gold") {
      const g: any = goldById.get(r.refId);
      const k: any = g && keyOf.get(`${g.exam_id}|${g.item_label}`);
      return g && k ? { answer: g.answer_display ?? "", type: k.type, keyCell: k.correct_answers, confirmed: true } : null;
    }
    const rv: any = revById.get(r.refId);
    const ie: any = rv && ieById.get(rv.item_explanation_id);
    const k: any = ie && keyOf.get(`${ie.exam_id}|${ie.item_label}`);
    return rv && ie && k ? { answer: rv.answer_display ?? "", type: k.type, keyCell: k.correct_answers, confirmed: !!ie.review_confirmed } : null;
  };
  const plan = planRejudge(rows, lookup, matchesKey);
  if (!apply || !plan.flips.length) return { ok: true, plan };

  const ids = plan.flips.map((f) => f.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { error: uErr } = await admin.from("tutor_judgments").update({ correct: true }).in("id", ids.slice(i, i + 150));
    if (uErr) return { ok: false, msg: "고치는 중 멈췄습니다: " + uErr.message, plan };
  }
  const goldFlip = plan.flips.filter((f) => f.kind === "gold").map((f) => f.refId);
  for (let i = 0; i < goldFlip.length; i += 150) {
    await admin.from("tutor_gold_attempts").update({ correct: true }).in("id", goldFlip.slice(i, i + 150));
  }
  return { ok: true, plan };
}
