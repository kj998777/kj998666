// 디지털화 문항 고치기(lib/digitize/itemEdit.ts) 테스트. `tsx test/itemEdit.test.ts`
import assert from "node:assert/strict";
import { changedFields, changedNumbers, cleanItemText, findDigitizedItem, mergeItemText, textOf } from "../lib/digitize/itemEdit";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};

const aiItem = {
  type: "question",
  label: "7",
  points: 4.2,
  stem: "함수 $f(x)=x^2-8x+3$ 의 최솟값은?",
  box_title: "",
  box_lines: [],
  choices: ["$-13$", "$-12$", "$-11$", "$-10$", "$-9$"],
  figures: [{ x0: 100, y0: 200, x1: 300, y1: 400, where: "stem", manual: true }],
  unsure: "둘째 항 계수가 흐림",
};

check("다듬기: 줄바꿈·공백·배점", () => {
  const r = cleanItemText({ label: " 7 ", points: "4.5", stem: "a\r\n\n\n\nb  ", box_lines: "ㄱ. x\n\n ㄴ. y ", choices: ["1", "", "3", "", ""] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.text.label, "7");
  assert.equal(r.text.points, 4.5);
  assert.equal(r.text.stem, "a\n\nb");
  assert.deepEqual(r.text.box_lines, ["ㄱ. x", "ㄴ. y"]);
  assert.deepEqual(r.text.choices, ["1", "", "3"]); // 가운데 빈 칸은 번호가 밀리지 않게 남김
});

check("다듬기: 거절", () => {
  assert.equal(cleanItemText({ stem: "  " }).ok, false);
  assert.equal(cleanItemText({ stem: "x", points: "abc" }).ok, false);
  assert.equal(cleanItemText({ stem: "x", points: 300 }).ok, false);
  assert.equal(cleanItemText({ stem: "x".repeat(7000) }).ok, false);
  assert.equal(cleanItemText({ stem: "x", choices: Array(9).fill("a") }).ok, false);
  assert.equal(cleanItemText(null).ok, false);
  const empty = cleanItemText({ stem: "x", points: "" });
  assert.ok(empty.ok && empty.text.points === null);
});

check("덮어쓰기: 그림 자리는 그대로, 처음 AI 글은 orig에 한 번만", () => {
  const t1 = cleanItemText({ ...textOf(aiItem), stem: "함수 $f(x)=x^2-6x+3$ 의 최솟값은?" });
  assert.ok(t1.ok);
  if (!t1.ok) return;
  const m1 = mergeItemText(aiItem, t1.text, "ai", "2026-09-30T00:00:00Z");
  assert.deepEqual(m1.figures, aiItem.figures);
  assert.equal(m1.stem, "함수 $f(x)=x^2-6x+3$ 의 최솟값은?");
  assert.equal(m1.orig.stem, aiItem.stem);
  assert.equal(m1.edited, "ai");
  const t2 = cleanItemText({ ...textOf(m1), points: 5 });
  assert.ok(t2.ok);
  if (!t2.ok) return;
  const m2 = mergeItemText(m1, t2.text, "manual", "2026-09-30T01:00:00Z");
  assert.equal(m2.orig.stem, aiItem.stem, "두 번째 고칠 때도 처음 AI 글 유지");
  assert.equal(m2.points, 5);
  assert.equal(m2.edited, "manual");
  // 되돌리기
  const back = cleanItemText(m2.orig);
  assert.ok(back.ok);
  if (!back.ok) return;
  const m3 = mergeItemText(m2, back.text, "revert", "x");
  assert.equal(m3.stem, aiItem.stem);
  assert.equal(m3.orig, undefined);
  assert.equal(m3.edited, undefined);
  assert.deepEqual(m3.figures, aiItem.figures);
  assert.equal(m3.type, "question");
});

check("바뀐 칸·숫자", () => {
  const a = textOf(aiItem);
  const b = { ...a, stem: "함수 $f(x)=x^2-6x+3$ 의 최솟값은?", choices: ["$-6$", "$-12$", "$-11$", "$-10$", "$-9$"] };
  const ch = changedFields(a, b);
  assert.deepEqual(
    ch.map((c) => c.key),
    ["stem", "choices"]
  );
  assert.deepEqual(changedNumbers(ch[0].before, ch[0].after), { removed: ["8"], added: ["6"] });
  assert.deepEqual(changedNumbers("x=12, y=12", "x=12, y=21"), { removed: ["12"], added: ["21"] });
  assert.deepEqual(changedFields(a, a), []);
});

check("채점 번호로 디지털화 문항 찾기", () => {
  const pages = [
    { page_no: 2, data: { items: [{ type: "question", label: "서답형 1" }, { type: "question", label: "27" }] } },
    { page_no: 1, data: { items: [{ type: "text", label: "", stem: "※" }, { type: "question", label: "1" }, { type: "question", label: "2." }] } },
  ];
  assert.deepEqual(findDigitizedItem(pages, "2"), { pageNo: 1, itemIndex: 2 });
  assert.deepEqual(findDigitizedItem(pages, "서답형1"), { pageNo: 2, itemIndex: 0 });
  assert.deepEqual(findDigitizedItem(pages, "27-(2)"), { pageNo: 2, itemIndex: 1 });
  assert.equal(findDigitizedItem(pages, "3"), null);
  assert.equal(findDigitizedItem(pages, ""), null);
  assert.equal(findDigitizedItem([{ page_no: 1, data: { items: [{ type: "question", label: "서술형 3" }] } }], "서3")?.itemIndex, 0);
});

console.log(`\n${n}개 통과`);
