import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 로그인 링크(매직 링크)를 클릭하면 여기로 돌아온다. code를 세션으로 교환한 뒤 대시보드로 보낸다.
//
// 중요: exchangeCodeForSession()은 "로그인 링크를 요청했을 때와 같은 브라우저(=같은 code_verifier
// 쿠키를 가진 브라우저)"에서 열려야만 성공한다(PKCE 방식의 정상 동작). 예를 들어 컴퓨터에서 이메일을
// 입력해 링크를 요청한 뒤, 휴대폰 메일 앱이나 다른 브라우저/시크릿창에서 그 링크를 열면 실패한다.
// 예전 코드는 이 실패를 무시하고 항상 /dashboard로 보냈는데, 그러면 로그인 안 된 상태로 대시보드에
// 갔다가 즉시 /login으로 튕기면서 "메일 재전송 -> 확인 -> 재전송" 무한 반복처럼 보이는 문제가 있었다.
// 이제는 실패 이유를 /login?error=... 로 명확히 알려준다.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // 비밀번호 재설정 링크는 ?next=/reset-password 를 붙여서 보낸다(resetPasswordForEmail 참고).
  const explicitNext = searchParams.get("next");
  let next = explicitNext || "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // next가 명시적으로 지정되지 않은 기본 경로(/dashboard)일 때만 role을 보고 tutor면
  // /tutor/dashboard로 바꿔 보낸다 — 비밀번호 재설정처럼 next가 명시된 흐름은 그대로 둔다.
  if (!explicitNext && data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if ((profile as any)?.role === "tutor") next = "/tutor/dashboard";
  }

  return NextResponse.redirect(`${origin}${next}`);
}
