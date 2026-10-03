// 풀이 결론 ≠ 정답 탐지(lib/review/solutionCheck.ts) — npx tsx test/solutionCheck.test.ts
import assert from "node:assert/strict";
import { checkSolution, displayValue, plainSolution, solutionChoice, solutionValue } from "../lib/review/solutionCheck";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};

const SOL_36 =
  "$f'(x)=24x-16$, $g'(x)=1$.<br>$f(1)=12-16+8=4$, $f'(1)=24-16=8$, $g(1)=4$, $g'(1)=1$.<br>곱의 미분법: $\\{f(x)g(x)\\}'=f'(x)g(x)+f(x)g'(x)$이므로<br>$x=1$에서 $8\\cdot4+4\\cdot1=32+4=36$... 재계산: $f'(1)g(1)=8\\times4=32$, $f(1)g'(1)=4\\times1=4$ → 합 36.<br><b>검산</b>: $f(x)g(x)=12x^3+20x^2-40x+24$, 도함수 $36x^2+40x-40$, $x=1$ 대입 $36+40-40=36$.";

check("원장님 사례: 정답 ④ (44)인데 풀이는 36으로 끝남 → 걸림", () => {
  const r = checkSolution("객관식", "4", "④ (44)", SOL_36);
  assert.equal(r.solChoice, "");
  assert.equal(r.solValue, "36");
  assert.equal(r.keyValue, "44");
  assert.equal(r.flagged, true);
  assert.ok(r.reasons.some((x) => x.includes("36")));
  assert.ok(r.doubtWords.includes("재계산"));
});

check("풀이가 '따라서 ③'으로 끝나고 정답표도 3이면 안 걸림", () => {
  const r = checkSolution("객관식", "3", "③ ($6$)", "$x=2$이므로 $y=6$<br>따라서 ③ $6$");
  assert.equal(r.solChoice, "3");
  assert.equal(r.flagged, false);
});

check("풀이는 '따라서 ②'인데 정답표가 5면 걸림", () => {
  const r = checkSolution("객관식", "5", "⑤ ($11$)", "… 개수는 23개이다.<br>따라서 ② $17$");
  assert.equal(r.solChoice, "2");
  assert.equal(r.flagged, true);
});

check("ㄱㄴㄷ 풀이에서 '②는 거짓' 같은 중간 언급은 결론으로 안 봄(단서말 뒤 번호만)", () => {
  const plain = plainSolution("ㄱ 참. ㄴ 거짓(②는 거짓). ㄷ 참.<br>따라서 옳은 것은 ㄱ, ㄷ이고 정답은 ③");
  assert.equal(solutionChoice(plain), "3");
});

check("주관식: 마지막 값이 정답표와 다르면 걸림, 같으면 안 걸림", () => {
  assert.equal(checkSolution("주관식", "44", "$44$", "$f'(1)=8$, $g(1)=4$ … $=32+4=36$.").flagged, true);
  assert.equal(checkSolution("주관식", "36", "$36$", "… $=32+4=36$.").flagged, false);
  assert.equal(checkSolution("주관식", "1/2", "$\\dfrac12$", "따라서 구하는 값은 $\\dfrac{1}{2}$이다.").flagged, false);
  assert.equal(checkSolution("주관식", "0.5", "", "따라서 $x=1/2$").flagged, false);
});

check("보조 함수들", () => {
  assert.equal(displayValue("④ ($-8$)"), "-8");
  assert.equal(displayValue("⑤ (ㄱ, ㄴ, ㄷ)"), "ㄱ,ㄴ,ㄷ");
  assert.equal(displayValue("③"), "");
  assert.equal(solutionValue(plainSolution("합은 $12$개이다.")), "12");
  assert.equal(solutionValue(plainSolution("따라서 $a+b=5$")), "5");
  assert.equal(plainSolution("$\\dfrac{3}{4}$<br>끝"), "3/4 끝");
});

check("빈 풀이나 값을 못 읽으면 안 걸림", () => {
  assert.equal(checkSolution("객관식", "2", "② (4)", "").flagged, false);
  assert.equal(checkSolution("객관식", "2", "② (4)", "그림을 보고 판단한다.").flagged, false);
});

console.log(`solutionCheck 테스트 ${n}개 통과`);
