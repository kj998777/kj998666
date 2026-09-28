import "server-only";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// #4: 과외선생님 전용 제출 링크(/s/코드?t=토큰). 이 링크로 들어온 제출에만 submissions.tutor_id가
// 기록되고, 과외선생님의 제출 현황·보고서에는 그 제출만 보인다(0017 마이그레이션 참고).
// tutor_links 테이블은 클라이언트 쓰기 정책이 없으므로 서비스롤로만 만든다.

/** 과외선생님 링크 토큰을 돌려준다(없으면 새로 만든다). */
export async function ensureTutorLinkToken(tutorId: string): Promise<string> {
  const admin = createAdminClient() as any;
  const { data: existing } = await admin.from("tutor_links").select("token").eq("tutor_id", tutorId).maybeSingle();
  if (existing?.token) return existing.token as string;

  for (let i = 0; i < 3; i++) {
    const token = randomBytes(6).toString("base64url"); // 8글자
    const { error } = await admin.from("tutor_links").insert({ tutor_id: tutorId, token });
    if (!error) return token;
    // 동시에 두 번 만들어졌으면(기본키 충돌) 먼저 만든 것을 쓴다.
    const { data: again } = await admin.from("tutor_links").select("token").eq("tutor_id", tutorId).maybeSingle();
    if (again?.token) return again.token as string;
  }
  throw new Error("제출 링크를 만들지 못했습니다.");
}

/** 토큰 → 과외선생님 id (없거나 형식이 이상하면 null). */
export async function tutorIdFromToken(token: unknown): Promise<string | null> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(t)) return null;
  const admin = createAdminClient() as any;
  const { data } = await admin.from("tutor_links").select("tutor_id").eq("token", t).maybeSingle();
  return (data?.tutor_id as string) ?? null;
}

export function tutorSubmitPath(examCode: string, token: string): string {
  return `/s/${encodeURIComponent(examCode)}?t=${encodeURIComponent(token)}`;
}

/** 과외선생님 링크 제출의 반 표시(학원 반 목록과 겹치지 않게, 과외선생님마다 구분되게). */
export function tutorClassLabel(token: string): string {
  return `과외-${token.slice(0, 6)}`;
}
