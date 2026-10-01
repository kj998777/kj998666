// 과외선생님이 푼 문제 목록(lib/ops/solves.ts) — npx tsx test/opsSolves.test.ts
import assert from "node:assert/strict";
import { buildSolveRows, summarize, type ReviewRow } from "../lib/ops/solves";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};
const rv = (o: Partial<ReviewRow>): ReviewRow => ({
  id: "r", item_explanation_id: "i1", exam_id: "e1", item_label: "3", tutor_id: "t1", kind: "primary", answer_display: "4", solution: "풀이",
  image_path: null, is_match: null, needs_verification: false, tiebreak: false, created_at: "2026-10-01T01:00:00Z", ...o,
});

check("검토·판정·정답 아는 문항·넘김을 최신순으로, 결과·포인트 붙이기", () => {
  const rows = buildSolveRows({
    reviews: [
      rv({ id: "a", created_at: "2026-10-01T01:00:00Z" }), // 판정 없음 → 그대로 반영
      rv({ id: "b", item_label: "5", tiebreak: true, image_path: "x.jpg", created_at: "2026-10-01T03:00:00Z" }), // 다수결 → 틀림
      rv({ id: "c", kind: "verify", item_label: "7", is_match: false, created_at: "2026-10-01T02:00:00Z" }), // 판정 전
      rv({ id: "d", item_label: "9", needs_verification: true, created_at: "2026-09-30T02:00:00Z" }),
    ],
    golds: [
      { id: "g1", tutor_id: "t1", item_explanation_id: "i9", exam_id: "e2", item_label: "1", answer_display: "2", solution: "", correct: true, submitted_at: "2026-10-01T04:00:00Z" },
      { id: "g2", tutor_id: "t1", item_explanation_id: "i8", exam_id: "e2", item_label: "2", answer_display: null, solution: null, correct: null, submitted_at: null },
    ],
    skips: [{ tutor_id: "t1", item_explanation_id: "i5", skipped_at: "2026-09-29T00:00:00Z" }],
    judgments: [{ review_id: "b", gold_attempt_id: null, correct: false, source: "majority" }],
    ledger: [
      { tutor_id: "t1", delta: 1, reason: "review_primary", ref_exam_id: "e1", ref_item_label: "3" },
      { tutor_id: "t1", delta: 2, reason: "review_primary", ref_exam_id: "e1", ref_item_label: "5" },
      { tutor_id: "t1", delta: 4, reason: "review_verify", ref_exam_id: "e1", ref_item_label: "7" },
      { tutor_id: "t1", delta: -3, reason: "download_purchase", ref_exam_id: "e1", ref_item_label: null },
    ],
  });
  assert.deepEqual(rows.map((r) => r.key), ["gg1", "rb", "rc", "ra", "rd", "st1|i5"]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.ra.result, "accepted");
  assert.equal(by.ra.points, 1);
  assert.equal(by.rb.result, "wrong");
  assert.equal(by.rb.resultNote, "다수결");
  assert.equal(by.rb.photoReviewId, "b");
  assert.equal(by.rb.points, 2);
  assert.equal(by.rc.kind, "verify");
  assert.equal(by.rc.result, "pending");
  assert.equal(by.rc.points, 4);
  assert.equal(by.rd.resultNote, "다른 선생님 판정 대기");
  assert.equal(by.gg1.result, "correct");
  assert.equal(by["st1|i5"].result, "skip");
  const s = summarize(rows);
  assert.deepEqual(s, { review: 3, verify: 1, gold: 1, skip: 1, correct: 1, wrong: 1, points: 7 });
});

console.log(`opsSolves: ${n}개 통과`);
