// 순수 함수 단위 테스트. 프로젝트 의존성 설치 없이 `tsx test/grading.test.ts` 로 바로 돌아간다.
import assert from "node:assert/strict";
import { isCorrect, normalizeAnswer, toNumber, gradeSubmission } from "../lib/grading";

let n = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    n++;
    console.log(`ok   - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    throw e;
  }
}

// --- normalizeAnswer ---
check("원문자 → 숫자", () => assert.equal(normalizeAnswer("③"), "3"));
check("전각 숫자/영문 → 반각", () => assert.equal(normalizeAnswer("ＡＢ１２"), "ab12"));
check("공백·쉼표 제거", () => assert.equal(normalizeAnswer(" 1, 2 3 "), "123"));
check("유니코드 마이너스 통일", () => assert.equal(normalizeAnswer("−5"), "-5"));
check("제곱 표기 통일 (² → ^2)", () => assert.equal(normalizeAnswer("x²"), "x^2"));
check("세제곱 표기 통일 (³ → ^3)", () => assert.equal(normalizeAnswer("x³"), "x^3"));
check("** → ^", () => assert.equal(normalizeAnswer("x**2"), "x^2"));
check("루트 표기 통일 (sqrt)", () => assert.equal(normalizeAnswer("sqrt3"), "√3"));
check("루트 표기 통일 (한글 '루트')", () => assert.equal(normalizeAnswer("루트3"), "√3"));
check("루트 표기 통일 (기호 √)", () => assert.equal(normalizeAnswer("√3"), "√3"));
check("√(3) → √3", () => assert.equal(normalizeAnswer("√(3)"), "√3"));
check("곱셈 기호 통일 (× → *)", () => assert.equal(normalizeAnswer("2×3"), "2*3"));
check("나눗셈 기호 통일 (÷ → /)", () => assert.equal(normalizeAnswer("6÷2"), "6/2"));
check("pi → π", () => assert.equal(normalizeAnswer("2pi"), "2π"));
check(">= → ≥, <= → ≤", () => {
  assert.equal(normalizeAnswer("x>=1"), "x≥1");
  assert.equal(normalizeAnswer("x<=1"), "x≤1");
});
check("대소문자 무시", () => assert.equal(normalizeAnswer("ABC"), "abc"));

// --- toNumber ---
check("분수 → 숫자", () => assert.equal(toNumber("3/4"), 0.75));
check("정수 → 숫자", () => assert.equal(toNumber("7"), 7));
check("소수 → 숫자", () => assert.equal(toNumber("0.75"), 0.75));
check("분모 0 → null", () => assert.equal(toNumber("3/0"), null));
check("숫자 아님 → null", () => assert.equal(toNumber("abc"), null));

// --- isCorrect: 동치 클래스 ---
check("분수=소수=약분분수 동치", () => {
  assert.equal(isCorrect("3/4", "0.75"), true);
  assert.equal(isCorrect("6/8", "3/4"), true);
});
check("원문자 정답과 숫자 정답 동치", () => assert.equal(isCorrect("③", "3"), true));
check("전각 숫자와 반각 정답 동치", () => assert.equal(isCorrect("３", "3"), true));
check("공백 차이 무시", () => assert.equal(isCorrect(" 1 2 3 ", "123"), true));
check("루트 표기 3종 모두 동치", () => {
  assert.equal(isCorrect("sqrt5", "√5"), true);
  assert.equal(isCorrect("루트5", "√5"), true);
});
check("곱셈/나눗셈 기호 표기 동치", () => {
  assert.equal(isCorrect("2×3", "2*3"), true);
  assert.equal(isCorrect("6÷2", "6/2"), true);
});
check("pi/π 표기 동치", () => assert.equal(isCorrect("2pi", "2π"), true));
check("부등호 표기 동치", () => {
  assert.equal(isCorrect("x>=1", "x≥1"), true);
  assert.equal(isCorrect("x<=1", "x≤1"), true);
});
check("복수 정답('|' 구분) 중 하나만 맞아도 정답", () => {
  assert.equal(isCorrect("삼", "3|삼|three"), true);
  assert.equal(isCorrect("3", "3|삼|three"), true);
  assert.equal(isCorrect("four", "3|삼|three"), false);
});
check("빈 답은 항상 오답", () => assert.equal(isCorrect("", "3"), false));
check("명백한 오답", () => assert.equal(isCorrect("4", "3"), false));

// --- gradeSubmission ---
check("gradeSubmission: 배점 합산 + 부동소수점 오차 제거", () => {
  const key = [
    { item_label: "1", correct_answers: "3", points: 3.6, type: "객관식" as const },
    { item_label: "2", correct_answers: "0.75", points: 3.7, type: "주관식" as const },
    { item_label: "3", correct_answers: "5", points: 2.7, type: "객관식" as const },
  ];
  const r = gradeSubmission(key, ["③", "3/4", "9"]);
  assert.equal(r.perItem[0].correct, true);
  assert.equal(r.perItem[1].correct, true);
  assert.equal(r.perItem[2].correct, false);
  assert.equal(r.totalScore, 7.3); // 3.6 + 3.7, 부동소수점 오차 없이 정확히 7.3
});
check("gradeSubmission: 문항 수 불일치 시 예외", () => {
  assert.throws(() => gradeSubmission([{ item_label: "1", correct_answers: "1", points: 1, type: "객관식" }], []));
});

console.log(`\n총 ${n}개 테스트 통과`);
