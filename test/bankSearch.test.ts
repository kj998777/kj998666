// 문항 은행 찾기 테스트. `tsx test/bankSearch.test.ts`
import assert from "node:assert/strict";
import { facets, parseFilter, search, type BankItem } from "../lib/bank/search";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};
const base: BankItem = {
  id: "", examId: "e1", examCode: "E1", examName: "2026 제주고 1-1 중간", examStatus: "열림", schoolLevel: "고", grade: 1, year: "2026", isJeju: true,
  label: "1", sortOrder: 0, area: "방정식과 부등식", unit: "이차방정식의 근과 계수의 관계", difficulty: "중", type: "객관식",
  statement: "두 근을 α, β라 할 때", answerDisplay: "③", correctAnswers: "3", points: 4, confirmed: true, hasLocation: true,
};
const items: BankItem[] = [
  { ...base, id: "a", label: "2", sortOrder: 1 },
  { ...base, id: "b", label: "1", sortOrder: 0, difficulty: "상", unit: "이차함수", statement: "포물선" },
  { ...base, id: "c", examId: "e2", examName: "2025 노형중 2-2 기말", schoolLevel: "중", grade: 2, year: "2025", isJeju: true, area: "도형", unit: "삼각형", type: "주관식" },
  { ...base, id: "d", examId: "e3", examName: "2026 경기고 1-1 기말", isJeju: false, confirmed: false },
];
check("기본: 확정된 것만, 최근 연도·같은 시험은 문항 순서", () => {
  assert.deepEqual(search(items, {}).map((x) => x.id), ["b", "a", "c"]);
});
check("확정 전 포함", () => assert.equal(search(items, { all: true }).length, 4));
check("단원 부분 일치·띄어쓰기 무시", () => assert.deepEqual(search(items, { unit: "근과계수" }).map((x) => x.id), ["a"]));
check("글자 찾기는 문제 글·단원·시험 이름", () => {
  assert.deepEqual(search(items, { q: "포물선" }).map((x) => x.id), ["b"]);
  assert.deepEqual(search(items, { q: "노형" }).map((x) => x.id), ["c"]);
});
check("학교급·학년·난이도·유형·제주", () => {
  assert.deepEqual(search(items, { level: "중" }).map((x) => x.id), ["c"]);
  assert.deepEqual(search(items, { diff: ["상"] }).map((x) => x.id), ["b"]);
  assert.deepEqual(search(items, { type: "주관식" }).map((x) => x.id), ["c"]);
  assert.equal(search(items, { jeju: true, all: true }).length, 3);
});
check("주소 값 읽기(잘못된 값은 무시)", () => {
  const f = parseFilter({ level: "고", grade: "9", diff: ["상", "x", "중"], jeju: "1", q: "  근 " });
  assert.equal(f.level, "고");
  assert.equal(f.grade, undefined);
  assert.deepEqual(f.diff, ["상", "중"]);
  assert.equal(f.jeju, true);
  assert.equal(f.q, "근");
});
check("고를 값 개수(자기 칸은 풀고 셈)", () => {
  const fc = facets(items, { diff: ["상"] });
  assert.equal(fc.diffs["중"], 2);
  assert.equal(fc.diffs["상"], 1);
  assert.deepEqual(fc.years, ["2026", "2025"]);
});
check("범위(과목·단원 체크) — 주소 course·u", () => {
  const f = parseFilter({ level: "고", grade: "1", course: "c1", u: "c1.2.1,bad" });
  assert.equal(f.course, "c1");
  assert.deepEqual(f.units, ["c1.2.1"]);
  assert.deepEqual(search(items, f).map((x) => x.id), ["a"]); // 근과 계수 → 복소수와 이차방정식, b(이차함수)는 다른 중단원
  assert.deepEqual(search(items, { ...f, units: ["c1.2.2"] }).map((x) => x.id), ["b"]);
  assert.equal(search(items, parseFilter({ level: "고", grade: "1", u: "none" })).length, 0); // 모두 해제
  assert.equal(parseFilter({ course: "zz" }).course, undefined);
});
console.log(`\n${n}개 통과`);
