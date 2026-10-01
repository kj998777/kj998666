// 2026-10-01 원장님 요청: "기출 원본"과 "메딕 콘텐츠"를 나눠 보여 준다(나중에 메딕 해설만 따로 값을 매길 수 있게 바탕을 깔아 둠).
//   - 학교 기출 원본(original): 학교 시험지 그대로(정답·해설 쪽만 뺌). 회원끼리 나누는 자료라 포인트로만 받는다.
//   - 메딕 해설(medic): 원장님·검토단이 만든 정답·풀이·난이도, 전체 문제 해설지, 성적 보고서, 맞춤 시험지의 정답·해설.
// 화면 배지(app/(tutor)/tutor/store/ContentKindBadge.tsx)와 PDF 머리말·꼬리말(buildReportPdf.ts, buildWorksheet.ts)이 이 문구를 같이 쓴다.

export type ContentKind = "original" | "medic";

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  original: "학교 기출 원본",
  medic: "메딕 해설",
};

export const CONTENT_KIND_NOTE: Record<ContentKind, string> = {
  original: "학교 시험지 그대로(정답·해설 쪽은 뺌). 회원끼리 나누는 자료라 포인트로만 받습니다.",
  medic: "원장님과 검토단이 만든 정답·풀이·난이도 정리, 해설지, 성적 보고서.",
};

/** 메딕 해설을 받는 화면에 붙이는 이용 안내 */
export const MEDIC_USE_NOTE =
  "메딕 해설은 본인 과외 수업 자료로만 써 주세요. 학생에게 나눠 주는 것은 괜찮지만, 다른 선생님에게 넘기거나 인터넷에 올리거나 팔면 안 됩니다.";

/** PDF(해설지·보고서) 꼬리말 — 메딕 해설임을 밝힌다 */
export const MEDIC_PDF_CREDIT =
  "정답·풀이·난이도 정리: 메딕수학 검토단 · 문제의 저작권은 출제한 학교에 있습니다 · 수업 자료로만 쓰고 인터넷에 올리거나 팔지 말아 주세요.";
