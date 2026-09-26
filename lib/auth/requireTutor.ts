import "server-only";
import { redirect } from "next/navigation";
import { getSessionAndRole, type SessionAndRole } from "./requireRole";

// 과외선생님(tutor) 전용 화면·액션에서 쓰는 검사. requireRole.ts 의 admin/editor/viewer 계층과는
// 절대 엮지 않는다 — tutor는 그 계층의 몇 등급이 아니라 완전히 분리된 새 트랙이다(설계 계획 참고).
// getSessionAndRole()만 재사용하고, "role이 정확히 tutor인가"만 그 자리에서 직접 비교한다.

/** 서버 컴포넌트(페이지/레이아웃)에서 사용. tutor가 아니면 리다이렉트하고 함수가 반환되지 않는다. */
export async function requireTutor(): Promise<SessionAndRole> {
  const session = await getSessionAndRole();
  if (!session) redirect("/login");
  if (session.role !== "tutor") redirect("/login");
  return session;
}

/** 서버 액션 / API 라우트 핸들러에서 사용. 리다이렉트 대신 JSON 오류를 돌려준다. */
export async function requireTutorApi(): Promise<
  { session: SessionAndRole; error?: undefined } | { session?: undefined; error: Response }
> {
  const session = await getSessionAndRole();
  if (!session) {
    return { error: Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 }) };
  }
  if (session.role !== "tutor") {
    return { error: Response.json({ ok: false, msg: "과외선생님 계정만 사용할 수 있습니다." }, { status: 403 }) };
  }
  return { session };
}
