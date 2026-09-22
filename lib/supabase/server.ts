import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

// 서버 컴포넌트 / 서버 액션 / 라우트 핸들러에서 쓰는 Supabase 클라이언트.
// 로그인한 사용자의 세션 쿠키를 그대로 사용하므로, 이 클라이언트로 하는 모든 조회·수정은
// RLS 정책상 "그 사용자 본인"의 권한으로 실행된다 (관리자 우회 없음).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // 서버 컴포넌트에서 호출되면 쓰기가 무시될 수 있음(미들웨어가 세션 갱신을 담당) — 정상 동작.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // 위와 동일한 이유로 무시 가능.
          }
        },
      },
    }
  );
}
