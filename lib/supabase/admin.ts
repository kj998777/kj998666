import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// 서비스 롤 키를 쓰는 관리자용 클라이언트 — RLS를 전부 우회한다.
// 반드시 서버 전용 코드에서만 import 할 것:
//   - 학생 제출 API(/api/submit/[code]) — 반 존재 검증 + 채점을 신뢰된 서버에서 원자적으로 처리
//   - 관리자 계정 초대/역할 변경(/admin/users) — auth.users 를 다루는 admin API 호출
// "server-only" 패키지가 클라이언트 번들에 실수로 포함되면 빌드 자체를 실패시켜 사고를 막아준다.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL 환경변수가 설정되지 않았습니다."
    );
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
