// 2026-10-04: 시험 코드의 한글 정규화(NFC/NFD) 차이로 QR이 "존재하지 않는 시험"이 되던 버그.
// 예전에 맥에서 받은 파일 이름(한글이 자모로 풀린 NFD)으로 만든 시험 17개는 코드가 NFD로 저장돼 있었고,
// 그 코드로 찍힌 QR을 휴대폰(아이폰 카메라·사파리 등)으로 열면 주소의 한글이 NFC로 바뀌어 들어와
// DB의 NFD 코드와 글자(바이트)가 달라 못 찾았다. 학생 제출 화면·제출 API·과외선생님 다운로드처럼
// 바깥(QR·링크)에서 코드가 들어오는 곳은 NFC·NFD 어느 쪽으로 와도 찾도록 후보를 모두 넘긴다.
// 순수 함수만 둔다(test/examCodeVariants.test.ts).

/** 들어온 코드의 정규화 후보(원래 글자, NFC, NFD) — 중복 없이, 원래 글자가 맨 앞. */
export function examCodeVariants(raw: string): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return Array.from(new Set([s, s.normalize("NFC"), s.normalize("NFD")]));
}

/** 후보로 찾은 시험 행들 중 하나 고르기: 글자가 똑같은 것 → NFC가 같은 것 순. 없으면 null. */
export function pickExamByCode<T extends { code: string }>(rows: T[] | null | undefined, raw: string): T | null {
  const list = rows ?? [];
  if (!list.length) return null;
  const s = String(raw ?? "").trim();
  const exact = list.find((r) => r.code === s);
  if (exact) return exact;
  const nfc = s.normalize("NFC");
  return list.find((r) => String(r.code).normalize("NFC") === nfc) ?? null;
}
