// 과외선생님 검토 화면(브라우저)에서 /api/tutor/review 를 부르는 도우미(2026-09-29).
// 서버 액션 대신 고정된 주소를 쓰므로 사이트가 업데이트된 뒤에도 열어 둔 화면에서 그대로 제출된다(route.ts 설명 참고).
// 연결 끊김·용량 초과·로그인 풀림·서버 오류를 각각 알아듣기 쉬운 문구로 바꿔 { ok:false, msg } 로 돌려준다(예외를 던지지 않음).

export type ReviewApiResult = { ok: boolean; msg?: string; [k: string]: any };

export async function callReviewApi(fields: Record<string, string | File | null | undefined>): Promise<ReviewApiResult> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v as any);
  let res: Response;
  try {
    res = await fetch("/api/tutor/review", { method: "POST", body: fd, credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, msg: "인터넷 연결이 불안정해 보내지 못했어요. 연결을 확인하고 다시 눌러 주세요(적던 답·풀이는 그대로 있어요)." };
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const body = (await res.json()) as ReviewApiResult;
      if (res.status === 401) return { ok: false, msg: "로그인이 풀렸어요. 새로고침해서 다시 로그인한 뒤 제출해 주세요(적던 글은 이 기기에 저장돼 있어요).", loggedOut: true };
      return body && typeof body === "object" ? body : { ok: false, msg: "서버 응답을 읽지 못했어요. 다시 눌러 주세요." };
    } catch {
      return { ok: false, msg: "서버 응답을 읽지 못했어요. 다시 눌러 주세요." };
    }
  }
  if (res.status === 413) return { ok: false, msg: "사진 용량이 너무 커서 보내지 못했어요. 다른 사진을 고르거나 화면을 캡처해서 다시 올려 주세요." };
  if (res.redirected && /\/login|\/pending/.test(res.url)) {
    return { ok: false, msg: "로그인이 풀렸어요. 새로고침해서 다시 로그인한 뒤 제출해 주세요(적던 글은 이 기기에 저장돼 있어요).", loggedOut: true };
  }
  return {
    ok: false,
    msg: `서버가 제대로 응답하지 않았어요(오류 ${res.status}). 잠시 후 다시 눌러 주세요. 계속되면 '버그 신고'로 알려 주세요.`,
  };
}
