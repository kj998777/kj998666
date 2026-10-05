import "server-only";
import { getSessionAndRole } from "@/lib/auth/requireRole";

// 오답 유사문제를 고를 수 있는 사람(2026-10-05 "학생이 아니라 선생님이 선택할 수 있게"):
//  - 원장님·편집자(admin/editor): 모든 제출
//  - 과외선생님(tutor): 본인 전용 링크로 들어온 제출(submissions.tutor_id = 본인)만
// 고르기 화면·저장 액션·후보 문제 그림 라우트가 모두 이 검사를 거친 뒤 서비스롤로 읽고 쓴다.

type Client = any;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PickWho = { userId: string; role: "admin" | "editor" | "tutor" };

export async function canPickFor(admin: Client, submissionId: string): Promise<{ ok: true; who: PickWho } | { ok: false; msg: string; status: number }> {
  const session = await getSessionAndRole();
  if (!session) return { ok: false, msg: "로그인이 필요합니다.", status: 401 };
  if (!UUID_RE.test(String(submissionId))) return { ok: false, msg: "제출을 찾지 못했습니다.", status: 404 };
  if (session.role === "admin" || session.role === "editor") return { ok: true, who: { userId: session.userId, role: session.role } };
  if (session.role === "tutor") {
    const { data } = await admin.from("submissions").select("tutor_id").eq("id", submissionId).maybeSingle();
    if (data && data.tutor_id === session.userId) return { ok: true, who: { userId: session.userId, role: "tutor" } };
    return { ok: false, msg: "선생님 학생의 제출이 아닙니다.", status: 403 };
  }
  return { ok: false, msg: "유사문제를 고를 권한이 없습니다.", status: 403 };
}
