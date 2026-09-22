"use client";

// 브라우저(클라이언트 컴포넌트)에서 쓰는 Supabase 클라이언트.
// anon key만 사용하고, RLS(행 단위 보안 규칙)가 실제 접근 제어를 담당한다.
// 절대 서비스 롤 키를 여기에 넣지 말 것 — 브라우저에 그대로 노출된다.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
