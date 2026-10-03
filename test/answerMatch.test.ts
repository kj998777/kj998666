// 정답표 ↔ 해설 정답 표시 맞추기(lib/review/answerMatch.ts) — npx tsx test/answerMatch.test.ts
import assert from "node:assert/strict";
import { formatKey, reconcileKeyDisplay, toKeyAnswer, tutorAnswerMatches } from "../lib/review/answerMatch";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};

check("formatKey: 객관식은 원문자, 복수 정답·여러 정답", () => {
  assert.equal(formatKey("객관식", "3"), "③");
  assert.equal(formatKey("객관식", "24"), "②④");
  assert.equal(formatKey("객관식", "3|4"), "③ 또는 ④");
  assert.equal(formatKey("주관식", "1/2"), "1/2");
  assert.equal(formatKey("주관식", " -8 "), "-8");
});

check("reconcile: 정답 표시가 정답표와 같으면 정답 표시를 그대로", () => {
  assert.deepEqual(reconcileKeyDisplay("객관식", "3", "③ ($6$)"), { text: "③ ($6$)", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("객관식", "3", "3번"), { text: "3번", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("주관식", "44", "$44$"), { text: "$44$", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("주관식", "-16", "-16"), { text: "-16", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("주관식", "1/2", "$\\dfrac{1}{2}$"), { text: "$\\dfrac{1}{2}$", mismatch: false });
});

check("reconcile: 다르면 정답표 쪽을 보여 주고 mismatch 표시 (원장님 제보 사례)", () => {
  assert.deepEqual(reconcileKeyDisplay("객관식", "2", "③ (2)"), { text: "②", mismatch: true });
  assert.deepEqual(reconcileKeyDisplay("객관식", "5", "② (17)"), { text: "⑤", mismatch: true });
  assert.deepEqual(reconcileKeyDisplay("객관식", "1", "② (6)"), { text: "①", mismatch: true });
  assert.deepEqual(reconcileKeyDisplay("주관식", "6", "$8$"), { text: "6", mismatch: true });
});

check("reconcile: 한쪽이 비어 있을 때", () => {
  assert.deepEqual(reconcileKeyDisplay("객관식", "4", ""), { text: "④", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("객관식", "", "④ ($8$)"), { text: "④ ($8$)", mismatch: false });
  assert.deepEqual(reconcileKeyDisplay("주관식", "", ""), { text: "", mismatch: false });
});

check("reconcile: 오탐 줄이기 — 정답표 그대로 적은 표시, 이스케이프된 표시, 주관식 'a=3'", () => {
  assert.equal(reconcileKeyDisplay("주관식", "√2/8|(√2)/8", "√2/8|(√2)/8").mismatch, false);
  assert.equal(reconcileKeyDisplay("주관식", "<UNKNOWN>", "&lt;UNKNOWN&gt;").mismatch, false);
  assert.equal(reconcileKeyDisplay("주관식", "3", "$a=3$").mismatch, false);
  assert.equal(reconcileKeyDisplay("주관식", "-10|8", "a=-10").mismatch, false);
  assert.equal(reconcileKeyDisplay("주관식", "3", "$a=4$").mismatch, true);
});

check("toKeyAnswer / tutorAnswerMatches 는 옮기기 전과 같은 동작", () => {
  assert.equal(toKeyAnswer("객관식", "④ 12"), "4");
  assert.equal(toKeyAnswer("객관식", "①③"), "13");
  assert.equal(toKeyAnswer("주관식", "$\\frac{1}{2}$"), "1/2");
  assert.equal(tutorAnswerMatches("객관식", "$4$", "4"), true);
  assert.equal(tutorAnswerMatches("객관식", "④ 12", "3"), false);
  assert.equal(tutorAnswerMatches("주관식", "", "3"), false);
});

console.log(`answerMatch 테스트 ${n}개 통과`);
