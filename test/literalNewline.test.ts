// 글자 그대로의 "\n" → 줄바꿈(lib/math/literalNewline.ts) — npx tsx test/literalNewline.test.ts
import assert from "node:assert/strict";
import { fixLiteralNewlines as f, fixLiteralNewlinesDeep } from "../lib/math/literalNewline";
import { normalizeTex } from "../lib/math/normalizeTex";
import { cleanItemText } from "../lib/digitize/itemEdit";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};
const BS = "\\";

check("글자 그대로의 \\n은 줄바꿈으로", () => {
  assert.equal(f(`함수${BS}n$f(x)=x^2$${BS}n가 있다.`), "함수\n$f(x)=x^2$\n가 있다.");
  assert.equal(f(`(가) 조건${BS}n(나) 조건`), "(가) 조건\n(나) 조건");
  assert.equal(f(`끝${BS}n`), "끝\n");
  assert.equal(f(`${BS}n${BS}n두 줄`), "\n\n두 줄");
  assert.equal(f(`다음을 보고${BS}nThen`), "다음을 보고\nThen");
});

check("n으로 시작하는 LaTeX 명령·\\\\ 줄바꿈 명령은 그대로", () => {
  for (const s of [`$a ${BS}neq b$`, `$x ${BS}ne 0$`, `$6${BS}notin X$`, `$${BS}nu$`, `$${BS}nabla f$`, `$a ${BS}nleq b$`, `$${BS}not= $`]) assert.equal(f(s), s);
  const cases = `$${BS}begin{cases} 1 ${BS}${BS}n=0 ${BS}end{cases}$`; // \\ 뒤의 n(변수) — 줄바꿈 아님
  assert.equal(f(cases), cases);
  assert.equal(f("진짜\n줄바꿈"), "진짜\n줄바꿈");
});

check("화면 그리기(normalizeTex)·문항 고치기(cleanItemText)·쪽 데이터에서도", () => {
  assert.equal(normalizeTex(`보기${BS}n$x ${BS}neq 1$`), `보기\n$x ${BS}neq 1$`);
  const r = cleanItemText({ label: "3", stem: `다음 함수${BS}n$f(x)=1$`, choices: [`1${BS}n`], box_lines: [] });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.text.stem, "다음 함수\n$f(x)=1$");
  const d = fixLiteralNewlinesDeep({ items: [{ stem: `가${BS}n나`, choices: [`$${BS}ne$`], points: 3 }] });
  assert.deepEqual(d, { items: [{ stem: "가\n나", choices: [`$${BS}ne$`], points: 3 }] });
});

console.log(`literalNewline: ${n}개 통과`);
