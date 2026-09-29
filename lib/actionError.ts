// 서버 액션을 부르다 예외가 나면(네트워크 끊김, 사진 용량 초과, 사이트가 방금 새로 배포돼 옛 화면의 버튼이 가리키는
// 서버 코드가 사라진 경우 등) 전에는 잡는 곳이 없어 화면 전체가 흰 "Application error" 화면으로 바뀌었다(2026-09-29 신고).
// 이제 버튼 쪽에서 try/catch로 잡아 이 함수로 알아듣기 쉬운 한국어 안내로 바꿔 보여 준다.
export function actionErrorMessage(e: unknown): { text: string; needsReload: boolean } {
  const raw = String((e as any)?.message ?? e ?? "");
  // 새 배포 뒤 옛 화면에서 누른 경우 — Next가 "Server Action ... was not found" / "Failed to find Server Action" 등으로 알린다.
  // (2026-09-29) "An unexpected response was received from the server"는 업데이트가 아니라 서버 오류(시간 초과 등)라 따로 안내한다.
  if (/unexpected response/i.test(raw)) {
    return { text: "서버가 제대로 응답하지 않았어요. 잠시 후 다시 눌러 주세요. 계속되면 '버그 신고'로 알려 주세요.", needsReload: false };
  }
  if (/server action|failed to find|deployment/i.test(raw)) {
    return {
      text: "사이트가 방금 업데이트돼서 이 화면으로는 보낼 수 없어요. 아래 '새로고침'을 누른 뒤 다시 제출해 주세요(적어 둔 답·풀이 글은 이 기기에 저장돼 있어요).",
      needsReload: true,
    };
  }
  if (/body exceeded|payload too large|413|too large/i.test(raw)) {
    return { text: "사진 용량이 너무 커서 보내지 못했어요. 다른 사진을 고르거나 화면을 캡처해서 다시 올려 주세요.", needsReload: false };
  }
  if (/failed to fetch|network|load failed|networkerror/i.test(raw)) {
    return { text: "인터넷 연결이 불안정해 보내지 못했어요. 연결을 확인하고 다시 눌러 주세요.", needsReload: false };
  }
  return {
    text: "보내는 중 문제가 생겼어요. 새로고침 후 다시 시도해 주세요. 계속되면 '버그 신고'로 알려 주세요.",
    needsReload: true,
  };
}
