// 학생별 제출 시험·문항별 답안(lib/students/submitted.ts) — npx tsx test/submittedExams.test.ts
import assert from "node:assert/strict";
import { buildSubmittedExams, keyText, circled } from "../lib/students/submitted";
import type { ExamMeta, ItemMeta, SubRow } from "../lib/students/analysis";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};

const exams = new Map<string, ExamMeta>([
  ["e1", { id: "e1", code: "A", name: "시험A", max: 10, n: 3 }],
  ["e2", { id: "e2", code: "B", name: "시험B", max: 8, n: 2 }],
]);
const it = (exam_id: string, label: string, sort_order: number, o: Partial<ItemMeta> = {}): ItemMeta => ({
  exam_id, label, sort_order, points: 4, type: "객관식", area: "", unit: "함수", difficulty: "중", correct_answers: "3", problem_statement: "문제" + label,
  answer_display: "", solution: "풀이" + label, ...o,
});
const items = [it("e1", "2", 2), it("e1", "1", 1, { points: 2 }), it("e1", "서1", 3, { type: "주관식", correct_answers: "5|-5" }), it("e2", "1", 1), it("e2", "2", 2)];
const sub = (o: Partial<SubRow>): SubRow => ({ id: "s", exam_id: "e1", class_label: " 고1 ", student_name: "가", tutor_id: null, submitted_at: "2026-10-01T00:00:00Z", total_score: 0, ...o });

check("최신순·정답표 순서·낸 답·정답·찍음·무응답", () => {
  const out = buildSubmittedExams(
    [
      sub({ id: "a", total_score: 6, submitted_at: "2026-09-01T00:00:00Z", per_item: [
        { item_label: "서1", given: "", correct: false, points: 0 },
        { item_label: "2", given: "3", correct: true, points: 4, guessed: true },
        { item_label: "1", given: "1", correct: true, points: 2 },
      ] as any }),
      sub({ id: "b", exam_id: "e2", total_score: 4, submitted_at: "2026-10-02T00:00:00Z", per_item: [{ item_label: "1", given: "2", correct: false, points: 0 }, { item_label: "2", given: "3", correct: true, points: 4 }] as any }),
    ],
    exams,
    items
  );
  assert.deepEqual(out.map((e) => e.code), ["B", "A"]);
  const a = out[1];
  assert.deepEqual(a.rows.map((r) => r.label), ["1", "2", "서1"]);
  assert.equal(a.rows[1].given, "③");
  assert.equal(a.rows[1].guessed, true);
  assert.equal(a.rows[2].blank, true);
  assert.equal(a.rows[2].key, "5 또는 -5");
  assert.equal(a.correct, 2);
  assert.equal(a.blank, 1);
  assert.equal(a.wrong, 0);
  assert.equal(a.realScore, 2); // 찍어서 맞힌 4점 빼기
  assert.equal(a.rate, 0.6);
  assert.equal(a.classLabel, "고1");
  assert.equal(a.attempt, null);
  assert.equal(out[0].wrong, 1);
});

check("같은 시험을 두 번 내면 몇 번째 제출인지", () => {
  const out = buildSubmittedExams(
    [sub({ id: "x", submitted_at: "2026-09-01T00:00:00Z", per_item: [] }), sub({ id: "y", submitted_at: "2026-09-05T00:00:00Z", per_item: [] })],
    exams,
    items
  );
  assert.deepEqual(out.map((e) => [e.submissionId, e.attempt]), [["y", 2], ["x", 1]]);
});

check("정답을 못 보여 주는 시험은 정답·문제·풀이를 비움", () => {
  const out = buildSubmittedExams([sub({ id: "z", per_item: [{ item_label: "1", given: "4", correct: false, points: 0 }] as any })], exams, items, () => false);
  const r = out[0].rows[0];
  assert.equal(out[0].showKey, false);
  assert.equal(r.key, null);
  assert.equal(r.problem, "");
  assert.equal(r.solution, "");
  assert.equal(r.given, "④");
});

check("동그라미 숫자·정답 글", () => {
  assert.equal(circled("객관식", "24"), "②④");
  assert.equal(circled("주관식", "24"), "24");
  assert.equal(keyText("객관식", "3|4"), "③ 또는 ④");
});

console.log(`submittedExams: ${n}개 통과`);
