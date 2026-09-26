import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/supabase/types";

// 이중 방어 패턴: 화면(서버 컴포넌트)에서 역할에 따라 버튼을 아예 숨기고,
// 실제 변경을 수행하는 서버 액션/라우트 핸들러에서도 반드시 이 파일의 함수로 다시 검사한다.
// 기존 Apps Script 시스템의 assertTeacher_()/assertOwner_() 패턴을 admin/editor/viewer 3단계로 확장한 것.

export type SessionAndRole = { userId: string; email: string; role: Role };

// 'tutor'는 이 계층에 없다 — 일부러다(아래 passesRole 참고). 과외선생님 전용 화면은
// lib/auth/requireTutor.ts 를 쓰고, 이 파일의 함수들과는 절대 엮지 않는다.
const RANK: Partial<Record<Role, number>> = { viewer: 0, editor: 1, admin: 2 };

// RANK에 없는 role(=tutor, 또는 앞으로 생길 비-계층 role)이면 무조건 실패시킨다.
// 주의: `RANK[session.role] < RANK[minRole]` 를 그냥 쓰면 role이 RANK에 없을 때
// `undefined < n` 이 자바스크립트에서 false가 되어 "차단"이 "통과"로 둔갑하는 함정이 있었다.
function passesRole(role: Role, minRole: Role): boolean {
  const r = RANK[role];
  const min = RANK[minRole];
  if (r === undefined || min === undefined) return false;
  return r >= min;
}

/** 로그인 상태 + 역할을 조회. 로그인 안 했거나 profiles 행이 없으면 null. */
export async function getSessionAndRole(): Promise<SessionAndRole | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = (await supabase
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .single()) as any;
  if (!profile) return null;

  return { userId: user.id, email: profile.email, role: profile.role };
}

/**
 * 서버 컴포넌트(페이지/레이아웃)에서 사용. 요구 역할 미달이면 리다이렉트하고 함수가 반환되지 않는다.
 * 예: const session = await requireRole('editor');  // admin도 통과(상위 역할 포함)
 */
export async function requireRole(minRole: Role): Promise<SessionAndRole> {
  const session = await getSessionAndRole();
  if (!session) redirect("/login");
  if (!passesRole(session.role, minRole)) redirect("/dashboard?denied=1");
  return session;
}

/**
 * 서버 액션 / API 라우트 핸들러에서 사용. 리다이렉트 대신 JSON 오류를 돌려줄 수 있도록
 * { session } 또는 { error: Response } 중 하나를 반환한다.
 */
export async function requireApiRole(
  minRole: Role
): Promise<{ session: SessionAndRole; error?: undefined } | { session?: undefined; error: Response }> {
  const session = await getSessionAndRole();
  if (!session) {
    return { error: Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 }) };
  }
  if (!passesRole(session.role, minRole)) {
    return { error: Response.json({ ok: false, msg: "이 작업을 할 권한이 없습니다." }, { status: 403 }) };
  }
  return { session };
}
