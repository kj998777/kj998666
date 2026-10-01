// 2026-10-01 원장님: "운영현황에서 과외선생님들이 어떤 문제를 풀었는지도 볼 수 있게".
// 과외선생님이 한 일(검토 제출·판정 제출·정답 아는 문항·넘긴 문항)을 한 줄씩 모아 최신순으로 늘어놓는 순수 계산.
// 화면(app/(staff)/admin/ops/solves)과 test/opsSolves.test.ts가 같이 쓴다.

export type SolveKind = "review" | "verify" | "gold" | "skip";
export type SolveResult = "correct" | "wrong" | "pending" | "accepted" | "skip";

export type ReviewRow = {
  id: string;
  item_explanation_id: string;
  exam_id: string;
  item_label: string;
  tutor_id: string;
  kind: "primary" | "verify";
  answer_display: string;
  solution: string | null;
  image_path: string | null;
  is_match: boolean | null;
  needs_verification: boolean | null;
  tiebreak: boolean | null;
  created_at: string;
};
export type GoldRow = {
  id: string;
  tutor_id: string;
  item_explanation_id: string;
  exam_id: string;
  item_label: string;
  answer_display: string | null;
  solution: string | null;
  correct: boolean | null;
  submitted_at: string | null;
};
export type SkipRow = { tutor_id: string; item_explanation_id: string; skipped_at: string };
export type JudgmentRow = { review_id: string | null; gold_attempt_id: string | null; correct: boolean; source: string };
export type LedgerRow = { tutor_id: string; delta: number; reason: string; ref_exam_id: string | null; ref_item_label: string | null };

export type SolveRow = {
  key: string;
  kind: SolveKind;
  tutorId: string;
  itemId: string;
  examId: string | null;
  label: string | null;
  at: string;
  answer: string;
  solution: string;
  /** 사진이 있으면 그 검토 제출 id(관리자 사진 주소 /admin/tutor-disputes/photo/<id>) */
  photoReviewId: string | null;
  result: SolveResult;
  resultNote: string;
  points: number | null;
};

export const KIND_LABEL: Record<SolveKind, string> = {
  review: "검토 제출",
  verify: "판정(두 번째 풀이)",
  gold: "정답 아는 문항",
  skip: "넘김",
};

const SOURCE_LABEL: Record<string, string> = { majority: "다수결", admin: "원장님 확정", gold: "정답 아는 문항", dispute: "이의제기" };

export function buildSolveRows(d: {
  reviews: ReviewRow[];
  golds: GoldRow[];
  skips: SkipRow[];
  judgments: JudgmentRow[];
  ledger: LedgerRow[];
}): SolveRow[] {
  const byReview = new Map<string, JudgmentRow>();
  const byGold = new Map<string, JudgmentRow>();
  for (const j of d.judgments) {
    if (j.review_id) byReview.set(j.review_id, j);
    if (j.gold_attempt_id) byGold.set(j.gold_attempt_id, j);
  }
  // 문항 검토·판정 포인트: 같은 선생님·시험·번호·사유로 묶어 더함(사유가 같은 문항을 두 번 내는 일은 없다)
  const pts = new Map<string, number>();
  for (const l of d.ledger) {
    if (!l.ref_exam_id || !l.ref_item_label) continue;
    if (l.reason !== "review_primary" && l.reason !== "review_verify") continue;
    const k = `${l.tutor_id}|${l.ref_exam_id}|${l.ref_item_label}|${l.reason}`;
    pts.set(k, (pts.get(k) ?? 0) + Number(l.delta || 0));
  }
  const out: SolveRow[] = [];
  for (const r of d.reviews) {
    const j = byReview.get(r.id);
    let result: SolveResult;
    let note: string;
    if (j) {
      result = j.correct ? "correct" : "wrong";
      note = SOURCE_LABEL[j.source] ?? j.source;
    } else if (r.kind === "verify") {
      result = "pending";
      note = r.is_match == null ? "판정 대기" : r.is_match ? "먼저 낸 답과 같음" : "먼저 낸 답과 다름";
    } else if (r.tiebreak || r.needs_verification) {
      result = "pending";
      note = "다른 선생님 판정 대기";
    } else {
      result = "accepted";
      note = "AI 답과 같아 그대로 반영";
    }
    const reason = r.kind === "verify" ? "review_verify" : "review_primary";
    const p = pts.get(`${r.tutor_id}|${r.exam_id}|${r.item_label}|${reason}`);
    out.push({
      key: "r" + r.id,
      kind: r.kind === "verify" ? "verify" : "review",
      tutorId: r.tutor_id,
      itemId: r.item_explanation_id,
      examId: r.exam_id,
      label: r.item_label,
      at: r.created_at,
      answer: r.answer_display,
      solution: r.solution ?? "",
      photoReviewId: r.image_path ? r.id : null,
      result,
      resultNote: note,
      points: p ?? null,
    });
  }
  for (const g of d.golds) {
    if (!g.submitted_at) continue; // 받기만 하고 안 낸 것
    const j = byGold.get(g.id);
    const c = j ? j.correct : g.correct;
    out.push({
      key: "g" + g.id,
      kind: "gold",
      tutorId: g.tutor_id,
      itemId: g.item_explanation_id,
      examId: g.exam_id,
      label: g.item_label,
      at: g.submitted_at,
      answer: g.answer_display ?? "",
      solution: g.solution ?? "",
      photoReviewId: null,
      result: c == null ? "pending" : c ? "correct" : "wrong",
      resultNote: "정답을 이미 아는 문항(실력 확인용)",
      points: null,
    });
  }
  for (const s of d.skips) {
    out.push({
      key: `s${s.tutor_id}|${s.item_explanation_id}`,
      kind: "skip",
      tutorId: s.tutor_id,
      itemId: s.item_explanation_id,
      examId: null,
      label: null,
      at: s.skipped_at,
      answer: "",
      solution: "",
      photoReviewId: null,
      result: "skip",
      resultNote: "풀지 않고 넘김",
      points: null,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)));
}

export type SolveSummary = { review: number; verify: number; gold: number; skip: number; correct: number; wrong: number; points: number };

export function summarize(rows: SolveRow[]): SolveSummary {
  const s: SolveSummary = { review: 0, verify: 0, gold: 0, skip: 0, correct: 0, wrong: 0, points: 0 };
  for (const r of rows) {
    s[r.kind]++;
    if (r.result === "correct") s.correct++;
    if (r.result === "wrong") s.wrong++;
    s.points += r.points ?? 0;
  }
  return s;
}
