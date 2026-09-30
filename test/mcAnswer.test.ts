// 객관식 답 모양 맞추기 테스트. `tsx test/mcAnswer.test.ts`
import assert from "node:assert/strict";
import { mcChoices, mcMatchesKeyCell, sameMcChoice } from "../lib/review/mcAnswer";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};

check("여러 모양 → 같은 번호", () => {
  for (const s of ["④", "4", "4번", "(4)", "4)", "$4$", "④ 12", "④ $\\frac{1}{2}$", "정답: 4", "답 ④", "４", "➃", " 4 번 "]) assert.equal(mcChoices(s), "4", s);
});
check("복수 선택", () => {
  for (const s of ["①③", "③①", "13", "1,3", "1, 3번", "1번, 3번", "1과 3"]) assert.equal(mcChoices(s), "13", s);
});
check("알아볼 수 없음", () => {
  for (const s of ["", "문제 오류", "x=3", "7", "12cm", "$\\frac{1}{2}$"]) assert.equal(mcChoices(s), "", s);
});
check("번호가 앞에 표시된 경우만 앞 번호", () => {
  assert.equal(mcChoices("4번 (x=2)"), "4");
  assert.equal(mcChoices("(2) 15"), "2");
});
check("정답표 칸과 비교(|는 여러 정답 중 하나)", () => {
  assert.equal(mcMatchesKeyCell("④", "4"), true);
  assert.equal(mcMatchesKeyCell("④", "4번"), true);
  assert.equal(mcMatchesKeyCell("③", "③ 12"), true);
  assert.equal(mcMatchesKeyCell("②", "4"), false);
  assert.equal(mcMatchesKeyCell("②", "2|4"), true);
  assert.equal(mcMatchesKeyCell("①③", "13"), true);
  assert.equal(mcMatchesKeyCell("①③", "1|3"), false); // 둘 다 고른 것 ≠ 둘 중 하나
  assert.equal(mcMatchesKeyCell("문제 오류", "4"), null);
});
check("두 선생님 답", () => {
  assert.equal(sameMcChoice("④", "4번"), true);
  assert.equal(sameMcChoice("④ 13", "④"), true); // 예전에는 "134"로 바뀌어 다른 답이 됐음
  assert.equal(sameMcChoice("①③", "3, 1"), true);
  assert.equal(sameMcChoice("②", "④"), false);
  assert.equal(sameMcChoice("x=2", "④"), null);
});
console.log(`\n${n}개 통과`);
