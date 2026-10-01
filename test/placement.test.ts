// 입학테스트 문항 고르기·배점·진단(lib/placement/pick.ts) — npx tsx test/placement.test.ts
import assert from "node:assert/strict";
import type { BankItem } from "../lib/bank/search";
import { diagnose, pickPlacement, pointsFor, replaceItem, scopeOptions, scopePool, subjectOf, targetCounts } from "../lib/placement/pick";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

const DIFFS = ["하", "중하", "중", "중상", "상"];
let seq = 0;
function item(over: Partial<BankItem>): BankItem {
  seq++;
  return {
    id: `id-${seq}`,
    examId: `ex-${seq % 6}`,
    examCode: `C${seq % 6}`,
    examName: "2025년 1학기 공통수학1 중간",
    examStatus: "닫힘",
    schoolLevel: "고",
    grade: 1,
    year: "2025",
    isJeju: true,
    label: String(seq),
    sortOrder: seq,
    area: "다항식",
    unit: `단원${seq % 7}`,
    difficulty: DIFFS[seq % 5],
    type: "객관식",
    statement: "문제",
    answerDisplay: "3",
    correctAnswers: "3",
    points: 4,
    confirmed: true,
    hasLocation: true,
    ...over,
  };
}
const pool = Array.from({ length: 80 }, () => item({}));

check("과목 읽기: 공통수학1·2, 수학 II, 연도 숫자 무시", () => {
  assert.equal(subjectOf("2025년 1학기 공통수학1 중간"), "공통수학1");
  assert.equal(subjectOf("남녕고 1-2 공통수학2 기말 2025"), "공통수학2");
  assert.equal(subjectOf("2023년 2학기 수학 II 중간_"), "수학Ⅱ");
  assert.equal(subjectOf("2024년 1학기 수학 I 기말"), "수학Ⅰ");
  assert.equal(subjectOf("2025년 1학기 수학 기말"), "");
});

check("난이도 목표: 10문항이면 2·2·3·2·1, 합은 늘 n", () => {
  assert.deepEqual(targetCounts(10), { 하: 2, 중하: 2, 중: 3, 중상: 2, 상: 1 });
  for (let k = 5; k <= 20; k++) assert.equal(Object.values(targetCounts(k)).reduce((a, b) => a + b, 0), k);
});

check("10문항 고르기: 개수·중복 없음·쉬운 문항부터", () => {
  const got = pickPlacement(pool, 10, 7);
  assert.equal(got.length, 10);
  assert.equal(new Set(got.map((x) => x.id)).size, 10);
  const idx = got.map((x) => DIFFS.indexOf(x.difficulty));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  const cnt: Record<string, number> = {};
  for (const x of got) cnt[x.difficulty] = (cnt[x.difficulty] ?? 0) + 1;
  assert.deepEqual(cnt, { 하: 2, 중하: 2, 중: 3, 중상: 2, 상: 1 });
});

check("단원이 겹치지 않게(7개 단원이면 10문항 중 7개 이상 다른 단원)", () => {
  const got = pickPlacement(pool, 10, 3);
  assert.ok(new Set(got.map((x) => x.unit)).size >= 7);
});

check("같은 seed면 같은 결과, 다른 seed면 대개 다름", () => {
  assert.deepEqual(pickPlacement(pool, 10, 11).map((x) => x.id), pickPlacement(pool, 10, 11).map((x) => x.id));
  assert.notDeepEqual(pickPlacement(pool, 10, 11).map((x) => x.id), pickPlacement(pool, 10, 12).map((x) => x.id));
});

check("어려운 문항이 모자라면 가까운 난이도에서 빌려 와 개수를 채운다", () => {
  const easy = pool.filter((x) => x.difficulty === "하" || x.difficulty === "중");
  const got = pickPlacement(easy, 10, 1);
  assert.equal(got.length, 10);
});

check("문항이 모자라면 있는 만큼만", () => {
  assert.equal(pickPlacement(pool.slice(0, 4), 10, 1).length, 4);
});

check("한 문항 바꾸기: 같은 난이도, 이미 고른·뺀 문항은 안 나옴", () => {
  const got = pickPlacement(pool, 10, 5);
  const ex = new Set<string>([got[4].id]);
  const r = replaceItem(pool, got, 4, 9, ex)!;
  assert.ok(r);
  assert.equal(r.difficulty, got[4].difficulty);
  assert.ok(!got.some((x) => x.id === r.id));
});

check("범위: 정답 없는·확정 안 된·다른 학년 문항은 빠진다", () => {
  const p = [
    item({ id: "a" }),
    item({ id: "b", correctAnswers: "" }),
    item({ id: "c", confirmed: false }),
    item({ id: "d", grade: 2 }),
    item({ id: "e", examName: "2025년 2학기 공통수학2 중간" }),
  ];
  assert.deepEqual(scopePool(p, { level: "고", grade: 1, subject: "공통수학1" }).map((x) => x.id), ["a"]);
  assert.deepEqual(scopePool(p, { level: "고", grade: 1, subject: "" }).map((x) => x.id), ["a", "e"]);
  const opts = scopeOptions(p);
  assert.deepEqual(opts.map((o) => `${o.level}${o.grade}:${o.n}`), ["고1:2", "고2:1"]);
});

check("배점: 합 100, 나머지는 뒤쪽 문항에", () => {
  assert.deepEqual(pointsFor(10), Array(10).fill(10));
  const p7 = pointsFor(7);
  assert.equal(p7.reduce((a, b) => a + b, 0), 100);
  assert.ok(p7[6] >= p7[0]);
});

check("진단: 찍어서 맞힌 문항은 실질 점수·단원·단계에서 빠진다", () => {
  const mk = (d: string, unit: string, correct: boolean, guessed = false) => ({ label: "x", unit, area: "", difficulty: d, points: 10, correct, guessed });
  const all = [
    mk("하", "A", true), mk("하", "A", true), mk("중하", "B", true), mk("중하", "B", true), mk("중", "C", true),
    mk("중", "C", true), mk("중", "D", true), mk("중상", "D", true), mk("중상", "E", true, true), mk("상", "E", false),
  ];
  const g = diagnose(all);
  assert.equal(g.score, 90);
  assert.equal(g.realScore, 80);
  assert.equal(g.level, "표준"); // 어려운 문항 3개 중 실제로 맞힌 건 1개
  assert.deepEqual(g.weakUnits, ["E"]);
  const top = diagnose(all.map((x) => ({ ...x, correct: true, guessed: false })));
  assert.equal(top.level, "심화");
  const low = diagnose(all.map((x, i) => ({ ...x, correct: i < 3, guessed: false })));
  assert.equal(low.level, "기초");
});

console.log(`\n총 ${n}개 테스트 통과`);
