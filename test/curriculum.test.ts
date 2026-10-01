// 단원표·문항 → 중단원 자동 분류(lib/curriculum/units.ts) — npx tsx test/curriculum.test.ts
// 운영 DB의 실제 영역(area)·단원(unit) 글(2026-10-01)로 확인한다.
import assert from "node:assert/strict";
import { buildTree, classify, cleanUnits, inUnitScope, scopeText, unitIdOf, unitName } from "../lib/curriculum/units";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}
const it = (schoolLevel: string, grade: number, area: string, unit = "", examName = "2025년 1학기 중간") => ({ schoolLevel, grade, examName, area, unit });
const nameOf = (x: ReturnType<typeof it>) => unitName(unitIdOf(x));

check("고1: 실제 영역 글 → 공통수학1·2 중단원", () => {
  assert.equal(nameOf(it("고", 1, "원의 방정식")), "원의 방정식");
  assert.equal(nameOf(it("고", 1, "평면좌표와 직선의 방정식")), "직선의 방정식");
  assert.equal(nameOf(it("고", 1, "직선·점의 좌표", "두 점 사이의 거리")), "평면좌표");
  assert.equal(nameOf(it("고", 1, "도형의 이동", "평행이동과 원의 방정식")), "도형의 이동");
  assert.equal(nameOf(it("고", 1, "도형의 이동·대칭")), "도형의 이동");
  assert.equal(nameOf(it("고", 1, "나머지정리와 인수분해", "복이차식의 인수분해")), "인수분해");
  assert.equal(nameOf(it("고", 1, "나머지정리와 인수분해", "나머지정리")), "항등식과 나머지정리");
  assert.equal(nameOf(it("고", 1, "다항식의 연산", "곱셈 공식의 변형")), "다항식의 연산");
  assert.equal(nameOf(it("고", 1, "복소수")), "복소수와 이차방정식");
  assert.equal(nameOf(it("고", 1, "여러 가지 방정식")), "여러 가지 방정식과 부등식");
  assert.equal(nameOf(it("고", 1, "집합")), "집합");
  assert.equal(nameOf(it("고", 1, "명제")), "명제");
  assert.equal(nameOf(it("고", 1, "함수·기타")), "함수");
  assert.equal(nameOf(it("고", 1, "행렬")), "행렬과 그 연산");
  assert.equal(classify(it("고", 1, "원의 방정식"))?.course, "c2");
  assert.equal(classify(it("고", 1, "복소수"))?.course, "c1");
});

check("고2: 수학Ⅱ 중단원(접선·평균값 정리는 도함수의 활용)", () => {
  assert.equal(nameOf(it("고", 2, "함수의 극한")), "함수의 극한");
  assert.equal(nameOf(it("고", 2, "함수의 연속")), "함수의 연속");
  assert.equal(nameOf(it("고", 2, "미분계수와 도함수")), "미분계수와 도함수");
  assert.equal(nameOf(it("고", 2, "접선의 방정식")), "도함수의 활용");
  assert.equal(nameOf(it("고", 2, "평균값 정리")), "도함수의 활용");
  assert.equal(nameOf(it("고", 2, "도함수의 활용(접선·증가감소·극대극소)")), "도함수의 활용");
  assert.equal(nameOf(it("고", 2, "방정식·부등식에의 활용과 최대최소")), "도함수의 활용");
  assert.equal(classify(it("고", 2, "함수의 극한", "", "2025년 1학기 수학Ⅱ 중간"))?.course, "s2");
});

check("중3: 이차함수·삼각비·통계 글이 여러 가지여도 같은 중단원", () => {
  assert.equal(nameOf(it("중", 3, "삼각비의 활용(넓이)")), "삼각비의 활용");
  assert.equal(nameOf(it("중", 3, "삼각비의 뜻")), "삼각비");
  assert.equal(nameOf(it("중", 3, "특수각의 삼각비와 삼각비의 값")), "삼각비");
  assert.equal(nameOf(it("중", 3, "이차함수 y=ax^2의 그래프")), "이차함수와 그 그래프");
  assert.equal(nameOf(it("중", 3, "이차함수의 그래프의 평행이동")), "이차함수와 그 그래프");
  assert.equal(nameOf(it("중", 3, "이차함수 y=ax^2+bx+c")), "이차함수 y=ax²+bx+c의 그래프");
  assert.equal(nameOf(it("중", 3, "이차함수의 식과 활용")), "이차함수 y=ax²+bx+c의 그래프");
  assert.equal(nameOf(it("중", 3, "이차함수의 활용과 함수값")), "이차함수 y=ax²+bx+c의 그래프");
  assert.equal(nameOf(it("중", 3, "산포도(분산·표준편차)")), "대푯값과 산포도");
  assert.equal(nameOf(it("중", 3, "대푯값")), "대푯값과 산포도");
  assert.equal(nameOf(it("중", 3, "상관관계·산점도")), "상관관계");
  assert.equal(nameOf(it("중", 3, "원의 접선")), "원과 직선");
  assert.equal(nameOf(it("중", 3, "이차방정식")), "이차방정식");
});

check("못 붙이면 그 학년 기타, 학년 없으면 빈 id", () => {
  assert.equal(unitIdOf(it("중", 3, "알 수 없음")), "M3.x");
  assert.equal(unitIdOf({ schoolLevel: "초", grade: 5, examName: "", area: "분수", unit: "" }), "");
  assert.equal(unitName("H1.x"), "기타(단원 분류 안 됨)");
});

check("범위 거르기·나무·글", () => {
  const items = [it("고", 1, "원의 방정식"), it("고", 1, "집합"), it("고", 1, "복소수"), it("고", 1, "???"), it("중", 3, "삼각비")];
  assert.equal(items.filter((x) => inUnitScope(x, { level: "고", grade: 1, course: "c2" })).length, 2);
  assert.equal(items.filter((x) => inUnitScope(x, { level: "고", grade: 1, units: ["c2.1.3", "H1.x"] })).length, 2);
  assert.equal(items.filter((x) => inUnitScope(x, { level: "고", grade: 1, units: [] })).length, 0);
  const t = buildTree(items);
  assert.deepEqual(t.map((g) => `${g.level}${g.grade}:${g.n}:${g.etc.n}`), ["중3:1:0", "고1:4:1"]);
  const g1 = t[1];
  assert.deepEqual(g1.courses.map((c) => `${c.name}:${c.n}`), ["공통수학1:1", "공통수학2:2"]);
  assert.equal(g1.courses[1].bigs[0].mids.length, 4); // 문항 없는 중단원도 다 보임
  assert.equal(scopeText({ level: "고", grade: 1, course: "c2", units: ["c2.1.3", "c2.2.1"] }), "고1 · 공통수학2 · 원의 방정식 외 1개 단원");
  assert.equal(scopeText({ level: "고", grade: 1, course: "", units: null }), "고1 · 전 과목");
  assert.deepEqual(cleanUnits("c2.1.3,bad,H1.x,c2.1.3"), ["c2.1.3", "H1.x"]);
});

console.log(`curriculum: ${n}개 통과`);
