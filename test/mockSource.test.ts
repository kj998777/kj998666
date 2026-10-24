// 모의고사 탭 분류(lib/exams/mockSource.ts) — node --experimental-strip-types test/mockSource.test.ts
import assert from "node:assert/strict";
import { compareMock, groupMocks, mockSource, mockYearLabel } from "../lib/exams/mockSource";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

check("출처: 평가원 / 교육청 / 사설", () => {
  assert.equal(mockSource("2025학년도 6월 모의평가 수학 (평가원)"), "평가원");
  assert.equal(mockSource("2026학년도 수능 수학"), "평가원");
  assert.equal(mockSource("2026학년도 대학수학능력시험 수학"), "평가원");
  assert.equal(mockSource("2027 9월 모평 수학"), "평가원");
  assert.equal(mockSource("2026년 10월 고3 학력평가 수학"), "교육청");
  assert.equal(mockSource("2027 이해원 모의고사 시즌3 1회"), "사설");
  assert.equal(mockSource("2027학년도 킬링캠프 시즌2 1회"), "사설");
  assert.equal(mockSource("수능 대비 사설 모의고사"), "사설"); // "N학년도 수능"이 아니면 사설
});

check("연도 폴더: 학년도(이름 → 따로 쓴 해 → 폴더 연도+1), 교육청은 치른 해", () => {
  assert.equal(mockYearLabel({ name: "2025학년도 수능 수학", folder_year: "2024" }), "2025학년도");
  assert.equal(mockYearLabel({ name: "2027 이해원 모의고사 시즌3 0회", folder_year: "2026" }), "2027학년도");
  assert.equal(mockYearLabel({ name: "2027학년도 킬링캠프 시즌2 1회", folder_year: "2027" }), "2027학년도");
  assert.equal(mockYearLabel({ name: "이름에 해 없는 모의고사", folder_year: "2026" }), "2027학년도");
  assert.equal(mockYearLabel({ name: "이름에 해 없는 모의고사", folder_year: null }), "연도 미지정");
  assert.equal(mockYearLabel({ name: "2026년 10월 고3 학력평가 수학", folder_year: "2026" }), "2026년");
});

check("순서: 6월 → 9월 → 수능, 회차는 0회 → 1회 → 10회", () => {
  const xs = ["2026학년도 수능 수학", "2026학년도 9월 모의평가 수학 (평가원)", "2026학년도 6월 모의평가 수학 (평가원)"].map((name) => ({ name }));
  assert.deepEqual([...xs].sort(compareMock).map((x) => x.name.slice(8, 10)), ["6월", "9월", "수능"]);
  const ys = ["A 시즌3 10회", "A 시즌3 2회", "A 시즌3 0회"].map((name) => ({ name }));
  assert.deepEqual([...ys].sort(compareMock).map((x) => x.name), ["A 시즌3 0회", "A 시즌3 2회", "A 시즌3 10회"]);
});

check("묶기: 모의고사만, 출처 → 최근 학년도 먼저", () => {
  const g = groupMocks([
    { name: "2025학년도 6월 모의평가 수학 (평가원)", folder_year: "2024", folder_kind: "모의고사" },
    { name: "2027학년도 9월 모의평가 수학 (평가원)", folder_year: "2026", folder_kind: "모의고사" },
    { name: "2027 이해원 모의고사 시즌3 1회", folder_year: "2026", folder_kind: "모의고사" },
    { name: "제주 ○○고 2학년 중간", folder_year: "2026", folder_kind: "중간" },
  ]);
  assert.deepEqual(
    g.map((x) => [x.source, x.count, x.years.map((y) => y.label)]),
    [
      ["평가원", 2, ["2027학년도", "2025학년도"]],
      ["교육청", 0, []],
      ["사설", 1, ["2027학년도"]],
    ]
  );
});

console.log(`mockSource: ${n}개 통과`);
