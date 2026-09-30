// 디지털화 의심 문항 찾기(lib/digitize/suspect.ts) 테스트. `tsx test/digitizeSuspect.test.ts`
import assert from "node:assert/strict";
import { answerChoiceValue, inspectItem, numbersOf, textHash } from "../lib/digitize/suspect";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};

const q = (stem: string, choices: string[] = [], extra: any = {}) => ({ type: "question", label: "7", stem, choices, box_lines: [], box_title: "", unsure: "", ...extra });

check("숫자 뽑기", () => {
  assert.deepEqual(numbersOf("$\\frac{3}{4}$ 와 $x^2-8x+15$ [4점]"), ["3", "4", "2", "8", "15"]);
  assert.deepEqual(numbersOf("x² + 1,000 = 0.50 ③"), ["2", "1000", "0.50"]);
  assert.deepEqual(numbersOf("\\sqrt{12}"), ["12"]);
});

check("정답 표시에서 선택지 값", () => {
  assert.deepEqual(answerChoiceValue("④ 12"), { n: 4, value: "12" });
  assert.deepEqual(answerChoiceValue("② $\\frac{1}{2}$"), { n: 2, value: "$\\frac{1}{2}$" });
  assert.equal(answerChoiceValue("④"), null);
  assert.equal(answerChoiceValue("12"), null);
});

check("숫자가 바뀐 문항 → 강한 의심", () => {
  const r = inspectItem({
    item: q("이차함수 $y=x^2-8x+13$ 의 최솟값은?", ["$-3$", "$-2$", "$-1$", "$0$", "$1$"]),
    summary: ["이차함수 $y=x^2-6x+13$ 의 최솟값을 구하는 문제"],
    solution: ["$y=(x-3)^2+4$ 이므로 최솟값 4"],
  });
  assert.ok(r.score >= 3, JSON.stringify(r));
  assert.equal(r.reasons[0].kind, "swap");
  assert.ok(r.reasons[0].text.includes("8") && r.reasons[0].text.includes("6"));
});

check("같게 읽은 문항 → 의심 없음", () => {
  const r = inspectItem({
    item: q("이차함수 $y=x^2-6x+13$ 의 최솟값은?", ["$1$", "$2$", "$3$", "$4$", "$5$"]),
    summary: ["이차함수 $y=x^2-6x+13$ 의 최솟값을 구하는 문제"],
    solution: ["$(x-3)^2+4$ 이므로 4"],
    mcAnswerDisplay: "④ 4",
  });
  assert.equal(r.score, 0, JSON.stringify(r));
});

check("정답 선택지 값이 다름 → 강한 의심", () => {
  const r = inspectItem({
    item: q("최솟값은?", ["$1$", "$2$", "$3$", "$21$", "$5$"]),
    summary: [],
    solution: [],
    mcAnswerDisplay: "④ 12",
  });
  assert.equal(r.reasons[0].kind, "choice");
  assert.ok(r.score >= 3);
});

check("AI가 흐리다고 남김 → 2점", () => {
  const r = inspectItem({ item: q("어떤 문제", [], { unsure: "지수가 흐림" }), summary: [], solution: [] });
  assert.equal(r.score, 2);
});

check("요약이 짧으면 숫자 비교 안 함", () => {
  const r = inspectItem({ item: q("$x=17$ 일 때"), summary: ["값 구하기"], solution: [] });
  assert.equal(r.score, 0);
});

check("글 지문은 글이 바뀔 때만 바뀜", () => {
  const a = q("x=1");
  assert.equal(textHash(a), textHash({ ...a, figures: [{ x0: 1 }] }));
  assert.notEqual(textHash(a), textHash({ ...a, stem: "x=2" }));
});

console.log(`\n${n}개 통과`);
