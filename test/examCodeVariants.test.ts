// 시험 코드 NFC/NFD 후보·고르기(lib/exams/codeVariants.ts) — npx tsx test/examCodeVariants.test.ts
import assert from "node:assert/strict";
import { examCodeVariants, pickExamByCode } from "../lib/exams/codeVariants";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

// 실제로 문제였던 코드: 맥 파일 이름(NFD)을 40글자에서 자른 것이라 끝 글자가 "하"(받침 없이 잘림)
const nfd = "제주_제주시_제주중앙여자고등학교 2학년 2023년 2학기 수학 II 중간".normalize("NFD").slice(0, 40);
const nfc = nfd.normalize("NFC");

check("NFD 코드 → 원래 글자·NFC·NFD 후보", () => {
  const v = examCodeVariants(nfd);
  assert.equal(v[0], nfd);
  assert.ok(v.includes(nfc));
  assert.notEqual(nfd, nfc);
  assert.equal(v.length, 2); // NFD 그 자체가 원래 글자라 2개
});

check("NFC로 들어와도(휴대폰 QR) NFD 후보가 들어간다", () => {
  const v = examCodeVariants(nfc);
  assert.equal(v[0], nfc);
  assert.ok(v.includes(nfd));
});

check("영문·숫자 코드는 후보 1개", () => {
  assert.deepEqual(examCodeVariants(" 2025-22M06 "), ["2025-22M06"]);
  assert.deepEqual(examCodeVariants(""), []);
});

check("고르기: 글자 같은 행 우선, 없으면 NFC가 같은 행", () => {
  const rows = [{ code: nfd, id: "a" }];
  assert.equal(pickExamByCode(rows, nfc)?.id, "a");
  assert.equal(pickExamByCode(rows, nfd)?.id, "a");
  const both = [{ code: nfc, id: "c" }, { code: nfd, id: "d" }];
  assert.equal(pickExamByCode(both, nfd)?.id, "d");
  assert.equal(pickExamByCode(both, nfc)?.id, "c");
  assert.equal(pickExamByCode([{ code: "다른시험", id: "x" }], nfc), null);
  assert.equal(pickExamByCode(null, nfc), null);
});

console.log(`examCodeVariants: ${n}개 통과`);
