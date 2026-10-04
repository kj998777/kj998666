// 시험 이름·코드 → 폴더 자동 분류(lib/exams/guessFolder.ts) — npx tsx test/guessFolder.test.ts
import assert from "node:assert/strict";
import { folderLabel, guessFolder, mergeFolder } from "../lib/exams/guessFolder";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  통과", name);
};

check("서울 파일 이름(밑줄)", () => {
  assert.deepEqual(guessFolder("서울_강남구_휘문고등학교 1학년 2025년 2학기 공통수학2 중간_"), {
    school_level: "고", folder_year: "2025", folder_grade: 1, folder_term: 2, folder_kind: "중간",
  });
});

check("제주 시험 이름, 수학 II", () => {
  assert.equal(folderLabel(guessFolder("제주 제주시 남녕고등학교 2학년 2023년 2학기 수학 II 중간")), "고 · 2023 · 2학년 · 2학기 · 중간");
});

check("줄인 학교 이름과 2025-2학기", () => {
  assert.equal(folderLabel(guessFolder("남녕고 1학년 2025-2학기 공통수학2 중간")), "고 · 2025 · 1학년 · 2학기 · 중간");
});

check("학교 이름 속 '중'·'고사'에 속지 않는다", () => {
  const g = guessFolder("제주 제주시 제주중앙여자고등학교 2학년 2025년 2학기 수학 II 중간");
  assert.equal(g.school_level, "고");
  const h = guessFolder("2025학년도 대기고 2학기 1차고사");
  assert.equal(h.school_level, "고");
  assert.equal(h.folder_year, "2025");
  assert.equal(h.folder_grade, null); // "2025학년도"의 5학년도 아님
  assert.equal(h.folder_kind, "중간");
});

check("중학교, 기말, 맥 파일 이름(NFD)", () => {
  const nfd = "제주 제주시 아라중학교 3학년 2024년 1학기 수학 기말.pdf".normalize("NFD");
  assert.equal(folderLabel(guessFolder(nfd)), "중 · 2024 · 3학년 · 1학기 · 기말");
  assert.equal(folderLabel(guessFolder("노형중 2 2학기 기말")).startsWith("중"), true);
});

check("코드 2025-22M04 꼴도 읽는다, 이름이 우선", () => {
  assert.deepEqual(guessFolder("제주여고 수학", "2025-22M04"), {
    school_level: "고", folder_year: "2025", folder_grade: 2, folder_term: 2, folder_kind: "중간",
  });
  assert.equal(guessFolder("2024년 1학기 기말", "2025-22M04").folder_year, "2024");
  assert.equal(guessFolder("", "2024-12F01").folder_kind, "기말");
});

check("못 읽으면 비워 둔다", () => {
  assert.equal(folderLabel(guessFolder("시험")), "");
  assert.equal(guessFolder("dg2025-mid").folder_term, null);
});

check("공통수학이면 고1로 보충", () => {
  const g = guessFolder("신성여고 공통수학1 기말");
  assert.equal(g.school_level, "고");
  assert.equal(g.folder_grade, 1);
});

check("초등학교는 학교급으로 쓰지 않는다(2026-10-03)", () => {
  const g = guessFolder("제주 제주시 아라초등학교 6학년 2025년 2학기 수학 중간");
  assert.equal(g.school_level, null);
  assert.equal(g.folder_term, 2); // 학기·구분 등 나머지는 그대로 읽는다
  assert.equal(g.folder_kind, "중간");
});

check("mergeFolder: 사람이 고른 값이 우선, 빈 칸만 채움", () => {
  const chosen = { school_level: null, folder_year: "2026", folder_grade: null, folder_term: null, folder_kind: null } as const;
  const m = mergeFolder({ ...chosen }, guessFolder("휘문고 1학년 2025년 2학기 중간"));
  assert.equal(m.folder_year, "2026");
  assert.equal(m.folder_grade, 1);
  assert.equal(m.folder_kind, "중간");
});

console.log(`guessFolder 테스트 ${n}개 통과`);
