import "server-only";
import { isCorrect } from "@/lib/grading";
import { fetchAllPages } from "@/lib/supabase/fetchAll";

// 정답표(answer_key)가 바뀐 뒤 이미 들어온 제출을 새 정답으로 다시 채점한다.
// 지금까지는 정답을 고쳐도 기존 채점 결과가 그대로 남았다(#3/#4에서 과외선생님 답 채택·수정 요청
// 반영으로 정답이 바뀌는 일이 생기면서 필요해짐). grading_results는 클라이언트 쓰기 정책이 없으므로
// 반드시 서비스롤 클라이언트로 부른다. 학생 답은 채점 결과(per_item)에 문항 번호와 함께 저장돼 있으므로
// 번호로 맞춰 다시 채점한다(정답표 줄 수가 달라져도 안전).
//
// 2026-10-03: regradePlan()으로 "무엇이 바뀌는지"만 먼저 볼 수 있게 나눴다(운영 현황의 전체 재채점,
// 결과 화면의 이 시험 재채점). regradeExam()은 예전처럼 바로 적용하고 바뀐 건수를 돌려준다.

type Client = any;
type PerItem = { item_label: string; given: string; correct: boolean; points: number; guessed?: boolean };

export type RegradeChange = {
  id: string;
  submission_id: string;
  from: number;
  to: number;
  /** 맞음↔틀림이 뒤집힌 문항 번호 */
  flipped: string[];
  perItem: PerItem[];
};

export type RegradePlan = {
  /** 살펴본 채점 결과 수 */
  checked: number;
  changes: RegradeChange[];
};

/** 이 시험의 모든 채점 결과를 지금 정답표로 다시 매겨 보고, 달라지는 것만 모은다(DB는 건드리지 않음). */
export async function regradePlan(admin: Client, examId: string): Promise<RegradePlan> {
  const [{ data: keys }, { data: results }] = await Promise.all([
    admin.from("answer_key").select("item_label, correct_answers, points, type").eq("exam_id", examId).order("sort_order").order("item_label"),
    // 2026-09-29: 제출이 1000건을 넘어도 전부 다시 채점하도록 끝까지 나눠 읽는다(lib/supabase/fetchAll.ts)
    fetchAllPages((f, t) =>
      admin.from("grading_results").select("id, submission_id, per_item, total_score").eq("exam_id", examId).order("id").range(f, t)
    ),
  ]);
  const key = (keys as any[]) ?? [];
  const rows = (results as any[]) ?? [];
  if (!key.length) return { checked: rows.length, changes: [] };

  const changes: RegradeChange[] = [];
  for (const r of rows) {
    const old: PerItem[] = Array.isArray(r.per_item) ? r.per_item : [];
    const givenBy = new Map(old.map((p) => [p.item_label, p.given ?? ""]));
    const oldOk = new Map(old.map((p) => [p.item_label, !!p.correct]));
    const guessedBy = new Set(old.filter((p) => p.guessed).map((p) => p.item_label)); // 2026-10-01: 찍음 표시는 그대로 둔다
    let total = 0;
    const perItem: PerItem[] = key.map((k) => {
      const given = String(givenBy.get(k.item_label) ?? "");
      const correct = isCorrect(given, k.correct_answers, k.type);
      const pts = Number(k.points) || 0;
      if (correct) total += pts;
      return { item_label: k.item_label, given, correct, points: correct ? pts : 0, ...(guessedBy.has(k.item_label) ? { guessed: true } : {}) };
    });
    total = Math.round(total * 100) / 100;
    const same =
      Number(r.total_score) === total &&
      old.length === perItem.length &&
      perItem.every((p, i) => old[i]?.item_label === p.item_label && !!old[i]?.correct === p.correct);
    if (same) continue;
    const flipped = perItem.filter((p) => (oldOk.get(p.item_label) ?? false) !== p.correct).map((p) => p.item_label);
    changes.push({ id: r.id, submission_id: r.submission_id, from: Number(r.total_score), to: total, flipped, perItem });
  }
  return { checked: rows.length, changes };
}

/** 계획대로 채점 결과를 고친다. 실제로 고친 건수. */
export async function applyRegradePlan(admin: Client, plan: RegradePlan): Promise<number> {
  // 2026-10-08 최적화: 하나씩 차례로 고치면 제출 200건 = 200번 왕복을 기다렸다. 8건씩 동시에 고친다(고치는 내용은 같음).
  let changed = 0;
  const BATCH = 8;
  for (let i = 0; i < plan.changes.length; i += BATCH) {
    const results = await Promise.all(
      plan.changes
        .slice(i, i + BATCH)
        .map((c) => admin.from("grading_results").update({ per_item: c.perItem, total_score: c.to }).eq("id", c.id))
    );
    for (const { error } of results as { error: unknown }[]) if (!error) changed++;
  }
  return changed;
}

export async function regradeExam(admin: Client, examId: string): Promise<number> {
  const plan = await regradePlan(admin, examId);
  if (!plan.changes.length) return 0;
  return applyRegradePlan(admin, plan);
}
