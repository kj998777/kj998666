// 화면용 수식 렌더(lib/math/renderMathHtml.ts): <br>·<b>만 살리고 나머지 태그는 글자로 — npx tsx test/renderMathHtml.test.ts
import assert from "node:assert/strict";
import { renderMathHtml } from "../lib/math/renderMathHtml";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};

// katex 없이 호출하면 수식 조각은 $…$ 그대로 글자로 남는다(이 테스트는 글자 조각의 처리만 본다).
check("<br>·<b>는 태그로 살린다", () => {
  const html = renderMathHtml(null, "첫 줄<br>둘째 줄 <b>강조</b> 끝");
  assert.equal(html, "첫 줄<br>둘째 줄 <b>강조</b> 끝");
});

check("<br/>·<BR>·공백 변형도 받는다", () => {
  assert.equal(renderMathHtml(null, "가<br/>나<BR>다<br />라"), "가<br>나<br>다<br>라");
});

check("다른 태그는 글자로 이스케이프", () => {
  assert.equal(renderMathHtml(null, "<script>x</script><i>i</i>"), "&lt;script&gt;x&lt;/script&gt;&lt;i&gt;i&lt;/i&gt;");
});

check("줄바꿈 문자도 <br>로", () => {
  assert.equal(renderMathHtml(null, "가\n나"), "가<br>나");
});

check("수식 조각은 건드리지 않는다(katex 없을 때 $ 유지)", () => {
  assert.equal(renderMathHtml(null, "값은 $a<b$ 이다<br>끝"), "값은 $a&lt;b$ 이다<br>끝");
});

console.log(`renderMathHtml 테스트 ${n}개 통과`);
