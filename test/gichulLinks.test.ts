// 기출 아이디어 연결(lib/exams/gichulLinks.ts) — node --experimental-strip-types test/gichulLinks.test.ts
import assert from "node:assert/strict";
import { cleanGichulInput, gichulCellText, groupGichul, parseGichulImport } from "../lib/exams/gichulLinks";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}
const PNG = "data:image/png;base64,iVBORw0KGgo=";

check("입력 다듬기: 출처 없으면 null, 공백 정리, 이상한 그림 버림", () => {
  assert.equal(cleanGichulInput({ label: "15", source: "  " }), null);
  assert.equal(cleanGichulInput({ label: "", source: "2026학년도 수능 공통 21번" }), null);
  const c = cleanGichulInput({ label: " 미적28 ", source: "2027학년도  9월 모평\n미적분 28번", idea: " 도형 ", image: "javascript:x", rank: 3 })!;
  assert.deepEqual(c, { label: "미적28", rank: 3, source: "2027학년도 9월 모평 미적분 28번", idea: "도형", image: null });
  assert.equal(cleanGichulInput({ label: "9", source: "a", image: PNG, rank: 99 })!.rank, 1);
  assert.equal(cleanGichulInput({ label: "9", source: "a", image: PNG })!.image, PNG);
});

check("묶기: 문항별·rank 순", () => {
  const m = groupGichul([
    { id: "b", item_label: "15", rank: 2, source: "B", idea: null },
    { id: "a", item_label: "15", rank: 1, source: "A", idea: "x", image: PNG },
    { id: "c", item_label: "확통30", rank: 1, source: "C", idea: "" },
  ]);
  assert.deepEqual(m["15"].map((x) => x.source), ["A", "B"]);
  assert.equal(m["15"][0].image, PNG);
  assert.equal(m["확통30"].length, 1);
});

check("JSON 한꺼번에: 배열/links, rank 자동, 잘못된 줄 건너뜀", () => {
  const r = parseGichulImport(JSON.stringify({ links: [{ label: "9", source: "A" }, { label: "9", source: "B" }, { label: "10", source: "" }, { label: "10", source: "C", rank: 2 }] }));
  assert.deepEqual(r.links.map((l) => [l.label, l.source, l.rank]), [["9", "A", 1], ["9", "B", 2], ["10", "C", 2]]);
  assert.equal(r.skipped, 1);
  assert.throws(() => parseGichulImport("{"));
  assert.throws(() => parseGichulImport('{"x":1}'));
});

check("보고서 칸 글", () => {
  assert.equal(gichulCellText(undefined), "");
  const m = groupGichul([{ item_label: "1", rank: 1, source: "A", idea: "" }, { item_label: "1", rank: 2, source: "B", idea: "" }]);
  assert.equal(gichulCellText(m["1"]), "A 외 1개");
});

console.log(`gichulLinks: ${n}개 통과`);
