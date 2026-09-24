import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// 임시 디버그 라우트 — 로그인 세션이 서버에서 왜 인식되지 않는지 원인 파악용.
// 문제 해결 후 삭제할 것.
export async function GET() {
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll().map((c) => ({ name: c.name, len: c.value.length }));

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  let profile = null;
  let profileError = null;
  if (userData.user) {
    const res = await supabase.from("profiles").select("role, email").eq("id", userData.user.id).single();
    profile = res.data;
    profileError = res.error;
  }

  return NextResponse.json({
    cookieNames: allCookies,
    user: userData.user ? { id: userData.user.id, email: userData.user.email } : null,
    userError: userError ? userError.message : null,
    profile,
    profileError: profileError ? profileError.message : null,
  });
}
