// 찍음 통계(lib/report/guessStats.ts) — npx tsx test/guessStats.test.ts
import assert from "node:assert/strict";
import { guessStatsByItem, guessTotals, manyGuessed } from "../lib/report/guessStats";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}
const p = (item_label: string, correct: boolean, guessed = false) => ({ item_label, correct, guessed });
const subs = [
  [p("1", true), p("2", true, true), p("3", false, true)],
  [p("1", true), p("2", false, true), p("3", false)],
  [p("1", false, true), p("2", true), p("3", true, true)],
  [p("1", true), p("2", true, true), p("3", false)],
];

check("문항별: 찍은 학생·그중 맞힘·확실히 맞힘", () => {
  const s = guessStatsByItem(subs, ["1", "2", "3"]);
  assert.deepEqual(s[1], { label: "2", n: 4, guessed: 3, guessedCorrect: 2, correct: 3, realCorrect: 1 });
  assert.deepEqual(s[0], { label: "1", n: 4, guessed: 1, guessedCorrect: 0, correct: 3, realCorrect: 3 });
});

check("반 전체: 찍은 학생 수·표시 건수·맞힌 건수", () => {
  assert.deepEqual(guessTotals(subs), { students: 4, studentsGuessed: 4, marks: 6, marksCorrect: 3 });
  assert.deepEqual(guessTotals([[p("1", true)], null]), { students: 2, studentsGuessed: 0, marks: 0, marksCorrect: 0 });
});

check("다시 가르칠 문항: 30% 이상·2명 이상, 많이 찍은 순", () => {
  assert.deepEqual(manyGuessed(guessStatsByItem(subs)).map((x) => x.label), ["2", "3"]); // 2번 3/4, 3번 2/4
  assert.deepEqual(manyGuessed(guessStatsByItem(subs), 0.6).map((x) => x.label), ["2"]);
  assert.deepEqual(manyGuessed(guessStatsByItem([[p("1", true, true)]])).map((x) => x.label), []); // 1명뿐이면 빼기
});

check("labels에 없는 문항도 뒤에 붙는다", () => {
  const s = guessStatsByItem([[p("9", true, true)]], ["1"]);
  assert.deepEqual(s.map((x) => x.label), ["1", "9"]);
  assert.equal(s[0].n, 0);
});

console.log(`\n총 ${n}개 테스트 통과`);
