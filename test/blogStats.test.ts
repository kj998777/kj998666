// 블로그 공개 집계 테스트. `tsx test/blogStats.test.ts`
import assert from "node:assert/strict";
import { computeBlogStats, MIN_SUBMISSIONS, type ExamRow, type KeyRow, type ExplRow, type GradingRow } from "../lib/blog/stats";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};

const NOW = new Date(Date.UTC(2026, 9, 1, 3, 0));
const exams: ExamRow[] = [
  { id: "A", school_level: "고", folder_grade: 1, folder_year: "2026", is_jeju: true, created_at: "2026-09-28T00:00:00Z" },
  { id: "B", school_level: "중", folder_grade: 3, folder_year: "2026", is_jeju: false, created_at: "2026-08-01T00:00:00Z" },
  { id: "C", school_level: "고", folder_grade: 2, folder_year: "2025", is_jeju: true, created_at: "2026-09-30T00:00:00Z" }, // 문항 없음
];
const keys: KeyRow[] = [
  { exam_id: "A", item_label: "1", type: "객관식", points: 3 },
  { exam_id: "A", item_label: "2", type: "객관식", points: 4 },
  { exam_id: "A", item_label: "3", type: "주관식", points: 5 },
  { exam_id: "A", item_label: "4", type: "객관식", points: 8 },
  { exam_id: "B", item_label: "1", type: "객관식", points: 0 },
  { exam_id: "B", item_label: "2", type: "주관식", points: 0 },
  { exam_id: "B", item_label: "9", type: "객관식", points: 2 }, // 해설 없음 → 제외
];
const expls: ExplRow[] = [
  { exam_id: "A", item_label: "1", area: "함수의 극한", unit: "극한값", difficulty: "하" },
  { exam_id: "A", item_label: "2", area: "함수의  극한", unit: "극한값", difficulty: "중" }, // 띄어쓰기 두 칸 → 같은 영역
  { exam_id: "A", item_label: "3", area: "함수의 연속", unit: "연속", difficulty: "상" },
  { exam_id: "A", item_label: "4", area: "함수의 연속", unit: "연속", difficulty: "중상" },
  { exam_id: "B", item_label: "1", area: "일차함수", unit: "기울기", difficulty: "중하" },
  { exam_id: "B", item_label: "2", area: "일차함수", unit: "기울기", difficulty: "이상한값" }, // 제외
];

check("문항·시험 수: 해설·난이도 있는 정답표 줄만, 문항 없는 시험 제외", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  assert.equal(s.totals.items, 5);
  assert.equal(s.totals.exams, 2);
  assert.equal(s.totals.highExams, 1);
  assert.equal(s.totals.midExams, 1);
  assert.equal(s.totals.jejuExams, 1);
  assert.equal(s.totals.scoredExams, 1);
  assert.equal(s.totals.areas, 3);
});

check("배점: 100점 환산, 기본 문항 비중", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  // A: 하3 중4 상5 중상8 = 20점 → 기본 7/20 = 35
  assert.equal(s.points.basicPer100!.mean, 35);
  assert.equal(s.points.topPer100!.mean, 25);
  assert.equal(s.points.byDifficulty["중상"].sharePct, 40);
  assert.equal(s.points.byDifficulty["상"].avgPerItem, 5);
});

check("영역: 공백 정리 후 묶음, 어려운 비율", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  const lim = s.areas.find((a) => a.name === "함수의 극한")!;
  assert.equal(lim.count, 2);
  assert.equal(lim.hardPct, 0);
  assert.equal(s.areas.find((a) => a.name === "함수의 연속")!.hardPct, 100);
});

check("학교급·유형", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  assert.equal(s.schoolLevel["고"].items, 4);
  assert.equal(s.schoolLevel["고"].hardPct, 50);
  assert.equal(s.schoolLevel["중"].basicLowPct, 100);
  assert.equal(s.types["서답형"].items, 1);
  assert.equal(s.types["서답형"].hardPct, 100);
});

check("최근 7일·월별", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  assert.equal(s.recent.last7d.exams, 1);
  assert.equal(s.recent.last7d.items, 4);
  assert.deepEqual(s.recent.byMonth, [
    { month: "2026-08", exams: 1 },
    { month: "2026-09", exams: 1 },
  ]);
});

check("학생 정답률: 제출이 적으면 숨김", () => {
  const g: GradingRow[] = Array.from({ length: MIN_SUBMISSIONS - 1 }, () => ({
    exam_id: "A",
    per_item: [{ item_label: "1", correct: true }],
  }));
  const s = computeBlogStats(exams, keys, expls, g, NOW);
  assert.equal(s.studentAccuracy.available, false);
  assert.equal(s.studentAccuracy.submissions, MIN_SUBMISSIONS - 1);
});

check("학생 정답률: 충분하면 난이도별, 답 50개 미만 묶음은 null", () => {
  const g: GradingRow[] = Array.from({ length: 60 }, (_, i) => ({
    exam_id: "A",
    per_item: [
      { item_label: "1", correct: i % 4 !== 0 }, // 75%
      { item_label: "3", correct: i % 2 === 0 }, // 50%
    ],
  }));
  g.push({ exam_id: "B", per_item: [{ item_label: "1", correct: true }] });
  const s = computeBlogStats(exams, keys, expls, g, NOW);
  assert.equal(s.studentAccuracy.available, true);
  assert.equal(s.studentAccuracy.byDifficulty["하"], 75);
  assert.equal(s.studentAccuracy.byDifficulty["상"], 50);
  assert.equal(s.studentAccuracy.byDifficulty["중하"], null);
  assert.equal(s.studentAccuracy.byArea[0].name, "함수의 연속");
});

check("공개 결과에 시험 id·이름이 들어가지 않음", () => {
  const s = computeBlogStats(exams, keys, expls, [], NOW);
  const txt = JSON.stringify(s);
  assert.ok(!/"A"|"B"|examId|exam_id|school_name/.test(txt));
});

console.log(`\n${n} passed`);
