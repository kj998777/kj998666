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
    // supabase-js는 내부적으로 전역 fetch()를 그대로 쓰는데, Next.js(App Router)가 이 fetch를
    // 자동으로 캐시하려 든다. 이 클라이언트를 쓰는 페이지(app/s/[code])는 export const
    // dynamic = "force-dynamic"으로 페이지 자체는 캐시하지 않게 해도, 그 안의 개별 fetch
    // 요청 자체는 여전히 캐시되는 경우가 있었다(Vercel 로그의 "Using cache" 표시로 확인됨) —
    // 학생이 QR로 접속했을 때 시험을 새로 만들거나 열었는데도 예전에 캐시된 "존재하지 않는
    // 시험" 응답이 계속 나오는 원인이었다. cache: "no-store"를 명시해 매번 새로 조회하도록
    // 강제한다.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
