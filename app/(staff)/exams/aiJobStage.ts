// AI 자동 처리 단계 이름표 — AiJobPanel(시험 1개 진행 화면)과 BatchAiJobPanel(여러 시험 한꺼번에
// 올릴 때 진행 화면)이 같은 표를 쓰도록 공유한다.

export const ACTIVE = new Set(["upload", "extract_submit", "extract_wait", "solve_submit", "solve_wait"]);

export const STAGE_LABEL: Record<string, string> = {
  upload: "시험지 업로드",
  extract_submit: "문항 추출 요청",
  extract_wait: "문항 추출 대기",
  solve_submit: "풀이 요청",
  solve_wait: "풀이 대기",
  review: "검수 대기",
  done: "완료",
  error: "오류",
};
