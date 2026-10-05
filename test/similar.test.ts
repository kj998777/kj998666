// 오답 유사문제 고르기(lib/similar/recommend.ts) — npx tsx test/similar.test.ts
import assert from "node:assert/strict";
import { examTwins, pickSimilar, targetsOf, type PoolItem, type SourceItem } from "../lib/similar/recommend";
import { LOGIC_TYPES, logicTypeListFor, subjectOfExam, validLogicType } from "../lib/similar/logicTypes";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

const p = (id: string, examId: string, difficulty: string, extra: Partial<PoolItem> = {}): PoolItem => ({
  id,
  examId,
  label: id,
  logicType: "c2.D1",
  difficulty,
  correctAnswers: id,
  year: "2025",
  grade: 1,
  usable: true,
  ...extra,
});
const src: SourceItem = { label: "7", logicType: "c2.D1", difficulty: "중", correctAnswers: "3", year: "2025", grade: 1 };

check("쉬운 것 1 → 같은 것 2 → 어려운 것 1", () => {
  const pool = [p("a", "E1", "중하"), p("b", "E1", "중"), p("c", "E2", "중"), p("d", "E2", "중"), p("e", "E3", "중상"), p("f", "E3", "상")];
  const r = pickSimilar(src, "E0", pool, "sub1");
  assert.deepEqual(r.map((x) => x.tier), ["easier", "same", "same", "harder"]);
  assert.equal(r[0].item.difficulty, "중하");
  assert.equal(r[3].item.difficulty, "중상");
  assert.ok(!r.some((x) => x.item.id === "f")); // 두 단계 어려운 건 안 씀
});

check("같은 시험·다른 유형·쓸 수 없는 문항은 빼기", () => {
  const pool = [p("a", "E0", "중"), p("b", "E1", "중", { logicType: "c2.A" }), p("c", "E1", "중", { usable: false }), p("d", "E2", "중")];
  const r = pickSimilar(src, "E0", pool, "s");
  assert.deepEqual(r.map((x) => x.item.id), ["d"]);
});

check("쉬운 칸이 비면 같은 난이도로 채운다", () => {
  const pool = [p("b", "E1", "중"), p("c", "E2", "중"), p("d", "E3", "중"), p("e", "E4", "중상")];
  const r = pickSimilar(src, "E0", pool, "s");
  assert.deepEqual(r.map((x) => x.tier), ["same", "same", "same", "harder"]);
});

check("'하'를 틀리면 쉬운 칸 없이 같은 것·어려운 것", () => {
  const s2 = { ...src, difficulty: "하" };
  const pool = [p("a", "E1", "하"), p("b", "E2", "하"), p("c", "E3", "중하"), p("d", "E4", "중")];
  const r = pickSimilar(s2, "E0", pool, "s");
  assert.deepEqual(r.map((x) => x.tier), ["same", "same", "harder"]);
});

check("같은 시험지를 두 번 올린 시험 묶기(번호 매김이 달라도)", () => {
  const ans = ["3", "8", "30", "√2", "2", "4"];
  const c = examTwins([
    { id: "b-exam", year: "2023", grade: 2, answers: ans },
    { id: "a-exam", year: "2023", grade: 2, answers: [...ans].reverse() }, // 순서가 달라도(단답형1 ↔ 22)
    { id: "c-exam", year: "2024", grade: 2, answers: ans }, // 연도 다르면 다른 시험
    { id: "d-exam", year: "2023", grade: 2, answers: ["1", "2", "3"] }, // 5문항 미만은 묶지 않음
    { id: "e-exam", year: "2023", grade: 2, answers: ["1", "2", "3"] },
  ]);
  assert.equal(c.get("b-exam"), "a-exam");
  assert.equal(c.get("a-exam"), "a-exam");
  assert.equal(c.get("c-exam"), "c-exam");
  assert.equal(c.get("d-exam"), "d-exam");
  assert.equal(c.get("e-exam"), "e-exam");
});

check("같은 화면에서 같은 문항이 두 번 나오지 않는다", () => {
  const pool = [p("b", "E1", "중"), p("c", "E2", "중"), p("d", "E3", "중")];
  const used = new Set<string>();
  const r1 = pickSimilar(src, "E0", pool, "s", used);
  const r2 = pickSimilar({ ...src, label: "8", correctAnswers: "9" }, "E0", pool, "s", used);
  const ids = [...r1, ...r2].map((x) => x.item.id);
  assert.equal(new Set(ids).size, ids.length);
});

check("같은 제출이면 순서가 늘 같다(새로고침해도)", () => {
  const pool = Array.from({ length: 12 }, (_, i) => p("q" + i, "E" + i, "중"));
  const a = pickSimilar(src, "E0", pool, "sub-xyz").map((x) => x.item.id);
  const b = pickSimilar(src, "E0", pool, "sub-xyz").map((x) => x.item.id);
  assert.deepEqual(a, b);
});

check("유형이 없으면 빈 목록", () => {
  assert.deepEqual(pickSimilar({ ...src, logicType: null }, "E0", [p("a", "E1", "중")], "s"), []);
});

check("틀린·무응답·찍어서 맞힌 문항만 고른다", () => {
  const t = targetsOf([
    { item_label: "1", correct: true, given: "3" },
    { item_label: "2", correct: false, given: "4" },
    { item_label: "3", correct: false, given: "" },
    { item_label: "4", correct: true, given: "2", guessed: true },
  ]);
  assert.deepEqual(t, [
    { label: "2", kind: "wrong" },
    { label: "3", kind: "blank" },
    { label: "4", kind: "guessed" },
  ]);
});

check("유형표 키 모양", () => {
  assert.ok(LOGIC_TYPES["c2.D1"] && LOGIC_TYPES["m2.D"] && LOGIC_TYPES["j3.K"] && LOGIC_TYPES["c1.H"]);
  assert.ok(!LOGIC_TYPES["c2.D"]); // 공통수학2 원(D)은 D1~D4로 나뉨
});

check("시험 이름으로 과목 정하기(새 시험 AI 유형 분류)", () => {
  assert.equal(subjectOfExam("제주_제주시_제주여자고등학교 1학년 2025년 2학기 공통수학2 중간_"), "c2");
  assert.equal(subjectOfExam("서울_강남구_숙명여자고등학교 1학년 2025년 2학기 공통수학1 기말_"), "c1");
  assert.equal(subjectOfExam("제주_제주시_오현고등학교 2학년 2023년 2학기 수학Ⅱ 기말_"), "m2");
  assert.equal(subjectOfExam("제주_제주시_아라중학교 3학년 2025년 2학기 중간_"), "j3");
  assert.equal(subjectOfExam("제주_제주시_남녕고등학교 2학년 2026년 2학기 미적분Ⅰ 부교재 변형 모의고사 1회"), "m2"); // 2022 개정 미적분Ⅰ = 예전 수학Ⅱ
  assert.equal(subjectOfExam("어떤고 2학년 미적분 기말"), null); // 모르는 과목은 유형을 정하지 않음(예전 미적분은 표 없음)
});

check("AI가 고른 유형 확인", () => {
  assert.equal(validLogicType("c2.D1", "c2"), "c2.D1");
  assert.equal(validLogicType("c2.D1", "m2"), null); // 다른 과목 유형
  assert.equal(validLogicType("c2.D", "c2"), null); // 표에 없음
  assert.ok(logicTypeListFor("c2").split("\n").every((l) => l.startsWith("c2.")));
});

console.log(`similar: ${n}개 통과`);
