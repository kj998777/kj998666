// 메딕차트 MCP 도구 인자 검사(lib/mcp/args.ts) — node --experimental-strip-types test/mcpArgs.test.ts
import assert from "node:assert/strict";
import { ToolError, arr, asArgs, auditArgs, bool, examCode, int, looksLikePdf, num, obj, oneOf, searchWord, str } from "../lib/mcp/args";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}
const throws = (fn: () => unknown) => assert.throws(fn, ToolError);

check("asArgs", () => {
  assert.deepEqual(asArgs(null), {});
  assert.deepEqual(asArgs([1]), {});
  assert.deepEqual(asArgs({ a: 1 }), { a: 1 });
});

check("str", () => {
  assert.equal(str({ a: "  x " }, "a"), "x");
  assert.equal(str({ a: "  x " }, "a", { trim: false }), "  x ");
  assert.equal(str({ a: 12 }, "a"), "12");
  assert.equal(str({}, "a"), undefined);
  throws(() => str({}, "a", { required: true }));
  throws(() => str({ a: "   " }, "a", { required: true }));
  throws(() => str({ a: "abcd" }, "a", { max: 3 }));
  throws(() => str({ a: {} }, "a"));
});

check("int·num", () => {
  assert.equal(int({ a: "3" }, "a"), 3);
  assert.equal(int({ a: 3 }, "a", { min: 1, max: 3 }), 3);
  throws(() => int({ a: 3.5 }, "a"));
  throws(() => int({ a: 4 }, "a", { max: 3 }));
  throws(() => int({ a: 0 }, "a", { min: 1 }));
  assert.equal(num({ a: "3.5" }, "a"), 3.5);
  throws(() => num({ a: "x" }, "a"));
  assert.equal(num({ a: "" }, "a"), undefined);
});

check("bool·oneOf", () => {
  assert.equal(bool({ a: "true" }, "a"), true);
  assert.equal(bool({ a: 0 }, "a"), false);
  assert.equal(bool({}, "a", true), true);
  throws(() => bool({ a: "yes" }, "a"));
  assert.equal(oneOf({ a: "열림" }, "a", ["열림", "닫힘"] as const), "열림");
  throws(() => oneOf({ a: "열기" }, "a", ["열림", "닫힘"] as const));
  throws(() => oneOf({}, "a", ["x"] as const, { required: true }));
});

check("obj·arr는 JSON 글도 받음", () => {
  assert.deepEqual(obj({ a: '{"공통":{"1":"3"}}' }, "a"), { 공통: { "1": "3" } });
  assert.deepEqual(obj({ a: { x: 1 } }, "a"), { x: 1 });
  throws(() => obj({ a: "[1]" }, "a"));
  throws(() => obj({}, "a", { required: true }));
  assert.deepEqual(arr({ a: "[1,2]" }, "a"), [1, 2]);
  throws(() => arr({ a: "x" }, "a"));
  throws(() => arr({ a: [1, 2, 3] }, "a", { max: 2 }));
});

check("examCode", () => {
  assert.equal(examCode({ code: " kice2709 " }), "kice2709");
  throws(() => examCode({}));
  throws(() => examCode({ code: "x".repeat(81) }));
});

check("searchWord: PostgREST 필터 특수 문자 제거", () => {
  assert.equal(searchWord("대기고,(2학년)"), "대기고 2학년");
  assert.equal(searchWord("a%b*c.d:e\"f'g\\h"), "a b c d e f g h");
  assert.equal(searchWord("x".repeat(50)).length, 40);
});

check("auditArgs: 긴 값은 길이만", () => {
  const out = auditArgs({ code: "k", base64: "A".repeat(400), answers: { 공통: { 1: "3" } }, big: { s: "x".repeat(3000) } });
  assert.equal(out.code, "k");
  assert.equal(out.base64, "<400자>");
  assert.deepEqual(out.answers, { 공통: { 1: "3" } });
  assert.match(String(out.big), /^<\d+자 JSON>$/);
});

check("looksLikePdf", () => {
  assert.equal(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n...")), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("\n\n%PDF-1.4")), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>")), false);
  assert.equal(looksLikePdf(new Uint8Array()), false);
});

console.log(`mcpArgs: ${n}개 통과`);
