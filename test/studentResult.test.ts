// 학생 제출 직후 내 결과(lib/report/studentResult.ts) — node --experimental-strip-types test/studentResult.test.ts
import assert from "node:assert/strict";
import { buildStudentResult } from "../lib/report/studentResult";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

check("내신: 틀린·무응답·찍어서 맞힘·영역·배점", () => {
  const key = [
    { item_label: "1", points: 3 },
    { item_label: "2", points: 4 },
    { item_label: "3", points: 4 },
    { item_label: "서답1", points: 5 },
  ];
  const per = [
    { item_label: "1", given: "2", correct: true, guessed: true },
    { item_label: "2", given: "3", correct: false },
    { item_label: "3", given: "", correct: false },
    { item_label: "서답1", given: "7", correct: true },
  ];
  const r = buildStudentResult(key, per, { totalScore: 8, areaOf: { "1": "함수", "2": "함수", 서답1: "수열" } });
  assert.equal(r.total, 8);
  assert.equal(r.max, 16);
  assert.equal(r.correct, 2);
  assert.deepEqual(r.wrong, ["2"]);
  assert.deepEqual(r.blank, ["3"]);
  assert.deepEqual(r.guessedRight, ["1"]);
  assert.deepEqual(r.areas, [
    { area: "함수", earned: 3, total: 7 },
    { area: "수열", earned: 5, total: 5 },
  ]);
  assert.deepEqual(r.byPoints, [
    { points: 3, correct: 1, n: 1 },
    { points: 4, correct: 0, n: 2 },
    { points: 5, correct: 1, n: 1 },
  ]);
  assert.equal(r.grade, null);
});

check("모의고사: 선택과목 번호·영역·예상 등급", () => {
  const key = [
    { item_label: "1", points: 2 },
    { item_label: "미적23", points: 2 },
    { item_label: "미적30", points: 4 },
  ];
  const per = [
    { item_label: "1", given: "3", correct: true },
    { item_label: "미적23", given: "1", correct: false },
    { item_label: "미적30", given: "20", correct: true },
  ];
  const r = buildStudentResult(key, per, { totalScore: 84, gradeCuts: { 미적: [86, 80, 72] }, choice: "미적" });
  assert.deepEqual(r.wrong, ["23"]);
  assert.deepEqual(r.areas.map((a) => a.area), ["공통(수학Ⅰ·수학Ⅱ)", "미적분"]);
  assert.deepEqual(r.grade, { label: "2등급", choice: "미적분", cuts: [86, 80, 72] });
});

console.log(`studentResult: ${n}개 통과`);
