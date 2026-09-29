// 학생 누적 분석 순수 함수 테스트. `tsx test/studentAnalysis.test.ts` 로 바로 돌아간다(가짜 데이터).
import assert from "node:assert/strict";
import {
  analyzeStudent,
  autoKey,
  decodeKey,
  encodeKey,
  groupStudents,
  makeResolver,
  mergeCandidates,
  trendOf,
  trendSvg,
  type ExamMeta,
  type ItemMeta,
  type SubRow,
} from "../lib/students/analysis";

let n = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    n++;
    console.log(`ok   - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    throw e;
  }
}

// 시험 3개(각 4문항, 25점씩)
const exams = new Map<string, ExamMeta>(
  ["e1", "e2", "e3"].map((id, i) => [id, { id, code: id.toUpperCase(), name: `시험${i + 1}`, max: 100, n: 4 }])
);
const units = ["이차방정식", "이차방정식", "함수", "확률"];
const diffs = ["하", "중", "중상", "상"] as const;
const items: ItemMeta[] = [];
for (const e of exams.keys())
  units.forEach((u, i) =>
    items.push({
      exam_id: e,
      label: String(i + 1),
      sort_order: i,
      points: 25,
      type: i === 3 ? "주관식" : "객관식",
      area: u === "함수" ? "함수" : u === "확률" ? "확률과 통계" : "방정식",
      unit: u,
      difficulty: diffs[i],
      problem_statement: `${u} 문제`,
      answer_display: "3",
      solution: "풀이",
    })
  );

function sub(id: string, exam: string, cls: string, name: string, ok: boolean[], at: string, tutor: string | null = null, blankIdx = -1): SubRow {
  const per = ok.map((c, i) => ({ item_label: String(i + 1), given: i === blankIdx ? "" : c ? "3" : "1", correct: c, points: c ? 25 : 0 }));
  return { id, exam_id: exam, class_label: cls, student_name: name, tutor_id: tutor, submitted_at: at, total_score: per.reduce((s, p) => s + p.points, 0), per_item: per };
}

const kim = [
  sub("s1", "e1", "고1 2반", "김철수", [true, false, false, false], "2026-03-10T01:00:00Z"),
  sub("s2", "e2", "고1 2반", "김철수 ", [true, true, false, false], "2026-05-10T01:00:00Z"),
  sub("s3", "e3", "고2 3반", "김철수", [true, true, true, false], "2026-07-10T01:00:00Z", null, 3),
];
const others = [
  sub("o1", "e1", "고1 2반", "이영희", [true, true, true, true], "2026-03-10T01:05:00Z"),
  sub("o2", "e1", "과외", "김철수", [true, true, false, false], "2026-03-11T01:05:00Z", "tutorA"),
  sub("o3", "e1", "과외", "김철수", [true, false, false, false], "2026-03-11T01:06:00Z", "tutorB"),
];

check("자동 키: 공백 정리, 과외는 선생님별", () => {
  assert.equal(autoKey(kim[0]), "반:고1 2반|김철수");
  assert.equal(autoKey(kim[1]), "반:고1 2반|김철수");
  assert.notEqual(autoKey(others[1]), autoKey(others[2]));
});

check("키 인코딩 왕복(한글) + 이상한 값 거부", () => {
  const k = "반:고1 2반|김철수";
  assert.equal(decodeKey(encodeKey(k)), k);
  assert.equal(decodeKey("!!!"), null);
  assert.equal(decodeKey(encodeKey("아무거나")), null);
});

check("합치기 사슬·고리 방지", () => {
  const r = makeResolver([
    { key: "a", merged_into: "b", hidden: false, memo: "" },
    { key: "b", merged_into: "c", hidden: false, memo: "" },
    { key: "x", merged_into: "y", hidden: false, memo: "" },
    { key: "y", merged_into: "x", hidden: false, memo: "" },
  ]);
  assert.equal(r("a"), "c");
  assert.equal(r("z"), "z");
  assert.ok(["x", "y"].includes(r("x")));
});

const all = [...kim, ...others];
check("합치기 전: 고1 2반/고2 3반 김철수는 다른 학생, 후보로 서로 보임", () => {
  const list = groupStudents(all, exams, []);
  assert.equal(list.length, 5);
  const a = list.find((s) => s.key === "반:고1 2반|김철수")!;
  assert.equal(a.nExams, 2);
  const c = mergeCandidates(a, list).map((s) => s.key);
  assert.ok(c.includes("반:고2 3반|김철수"));
  assert.ok(c.includes("과외:tutorA|김철수"));
});

check("합친 뒤: 3회, 시간순 득점률 25→50→75, 반 이름 최근 것부터", () => {
  const list = groupStudents(all, exams, [{ key: "반:고1 2반|김철수", merged_into: "반:고2 3반|김철수", hidden: false, memo: "메모" }]);
  const k = list.find((s) => s.key === "반:고2 3반|김철수")!;
  assert.equal(k.nExams, 3);
  assert.deepEqual(k.rates, [0.25, 0.5, 0.75]);
  assert.deepEqual(k.classLabels, ["고2 3반", "고1 2반"]);
  assert.equal(list.length, 4);
});

check("추이: 오름 / 비슷 / 내림 / 1회", () => {
  assert.equal(trendOf([0.25, 0.5, 0.75]).direction, "up");
  assert.equal(trendOf([0.7, 0.71, 0.69]).direction, "flat");
  assert.equal(trendOf([0.9, 0.6]).direction, "down");
  assert.equal(trendOf([0.9]).direction, "none");
});

const peers = all.map((s) => ({ exam_id: s.exam_id, class_label: s.class_label, total_score: s.total_score }));
const A = analyzeStudent(kim, exams, items, peers);

check("시험별 결과·반 평균(2명 이상일 때만)", () => {
  assert.equal(A.exams.length, 3);
  assert.equal(A.exams[0].rate, 0.25);
  assert.equal(A.exams[0].classAvg, (0.25 + 1) / 2); // 고1 2반: 김철수 25, 이영희 100
  assert.equal(A.exams[2].classAvg, null); // 고2 3반은 혼자
  assert.equal(A.exams[0].examAvg, (0.25 + 1 + 0.5 + 0.25) / 4);
  assert.equal(A.exams[2].blank, 1);
  assert.equal(A.exams[2].wrong, 0);
});

check("단원·난이도·유형 집계", () => {
  const eq = A.units.find((u) => u.name === "이차방정식")!;
  assert.equal(eq.n, 6);
  assert.equal(eq.ok, 5);
  const hard = A.diffs.find((d) => d.name === "상")!;
  assert.equal(hard.ok, 0);
  assert.equal(A.types.find((t) => t.name === "주관식")!.n, 3);
  assert.equal(A.totalItems, 12);
  assert.equal(A.okItems, 6);
});

check("약점 단원: 확률(0/3)·함수(1/3) 순, 다 맞힌 단원 없음", () => {
  assert.deepEqual(
    A.weakUnits.map((u) => u.name),
    ["확률", "함수"]
  );
});

check("다시 풀 문항: 약점 단원 먼저, 최대 10개, 중복 없음", () => {
  assert.ok(A.review.length > 0 && A.review.length <= 10);
  const keys = A.review.map((r) => r.examId + r.item.label);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(["함수", "확률"].includes(A.review[0].item.unit));
});

check("종합 의견: 오름 흐름·복습 단원 문장", () => {
  const t = A.advice.join(" ");
  assert.match(t, /오르는 흐름/);
  assert.match(t, /우선 복습할 단원: 확률/);
});

check("영역 변화: 방정식 앞 1회 vs 뒤 2회(2문항 이상일 때만)", () => {
  // 앞 절반 = e1(방정식 2문항 중 1), 뒤 = e2,e3(4문항 중 4)
  const c = A.areaChanges.find((x) => x.name === "방정식")!;
  assert.equal(c.before, 0.5);
  assert.equal(c.after, 1);
});

check("같은 시험 두 번 제출이면 마지막 것만", () => {
  const dup = [...kim, sub("s4", "e3", "고2 3반", "김철수", [true, true, true, true], "2026-07-11T01:00:00Z")];
  const B = analyzeStudent(dup, exams, items, []);
  assert.equal(B.exams.length, 3);
  assert.equal(B.exams[2].rate, 1);
});

check("그래프 SVG: 점 3개, 이름 이스케이프", () => {
  const svg = trendSvg([
    { name: "<시험>", submittedAt: "2026-03-10T00:00:00Z", rate: 0.5, classAvg: 0.6 },
    { name: "b", submittedAt: "2026-04-10T00:00:00Z", rate: 0.7, classAvg: null },
    { name: "c", submittedAt: "2026-05-10T00:00:00Z", rate: 0.9, classAvg: 0.8 },
  ]);
  assert.equal((svg.match(/r="4"/g) || []).length, 3);
  assert.ok(svg.includes("&lt;시험&gt;"));
  assert.ok(!svg.includes("<시험>"));
});

check("시험 없음", () => {
  const E = analyzeStudent([], exams, items, []);
  assert.deepEqual(E.advice, ["아직 채점된 시험이 없습니다."]);
});

console.log(`\n${n}개 통과`);
