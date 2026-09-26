"use client";

// 매직 링크(이메일 인증 메일) 방식은 "요청한 브라우저와 클릭한 브라우저가 달라야 실패"하는 PKCE
// 제약과, Resend 무료 발신 주소가 스팸함으로 분류되는 문제가 겹쳐서 로그인이 계속 반복되는
// 것처럼 느껴지는 문제가 있었다. 그래서 이메일+비밀번호 방식으로 전환한다 — 로그인할 때마다
// 이메일을 열어볼 필요가 없어서 이런 문제 자체가 생기지 않는다. 비밀번호를 잊었거나(또는 예전
// 매직 링크 방식으로만 가입해서 비밀번호가 아예 없는 계정) 재설정이 필요한 경우에만 이메일
// 링크(→ /reset-password)를 한 번 사용한다.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    const supabase = createClient();

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      setBusy(false);
      if (error) {
        setErr("재설정 메일을 보내지 못했습니다: " + error.message);
        return;
      }
      setMsg(
        `${email.trim()} 주소로 비밀번호 재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 ` +
          "확인해서 링크를 눌러 주세요. 지금 이 화면과 같은 브라우저에서 열어야 합니다."
      );
      return;
    }

    if (mode === "login") {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setBusy(false);
        setErr(
          error.message.includes("Invalid login credentials")
            ? "이메일 또는 비밀번호가 올바르지 않습니다. (비밀번호를 설정한 적이 없다면 아래 " +
                "\"비밀번호를 잊으셨나요?\"를 눌러 설정해 주세요.)"
            : "로그인하지 못했습니다: " + error.message
        );
        return;
      }
      // 과외선생님(tutor)은 직원 대시보드가 아니라 /tutor/dashboard로 보낸다. 본인 profiles 행은
      // RLS(profiles_select_own_or_admin)가 항상 허용하므로 여기서 바로 조회할 수 있다.
      let dest = "/dashboard";
      if (signInData.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", signInData.user.id)
          .maybeSingle();
        if ((profile as any)?.role === "tutor") dest = "/tutor/dashboard";
      }
      setBusy(false);
      // 서버 컴포넌트/미들웨어가 새 세션 쿠키를 확실히 읽도록 클라이언트 라우팅 대신
      // 전체 페이지 이동을 사용한다.
      window.location.href = dest;
      return;
    }

    // 회원가입
    if (password.length < 6) {
      setBusy(false);
      setErr("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setErr(
        error.message.toLowerCase().includes("already registered")
          ? "이미 가입된 이메일입니다. 로그인해 주세요. (예전에 이메일 링크로만 가입해서 " +
              "비밀번호가 없다면 \"비밀번호를 잊으셨나요?\"로 설정해 주세요.)"
          : "회원가입하지 못했습니다: " + error.message
      );
      return;
    }
    if (data.session) {
      // 이메일 확인 절차 없이 바로 로그인된 상태
      window.location.href = "/dashboard";
      return;
    }
    setMsg("가입이 완료되었습니다. 아래에서 로그인해 주세요.");
    setMode("login");
    setPassword("");
  }

  const title = mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : "비밀번호 재설정";
  const subtitle =
    mode === "login"
      ? "이메일과 비밀번호로 로그인하세요."
      : mode === "signup"
        ? "이메일과 비밀번호로 계정을 만드세요."
        : "가입할 때 쓴 이메일 주소를 입력하면 재설정 링크를 보내드립니다.";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">학원 시험관리 {title}</h1>
        <p className="text-sm text-slate-500 mb-4 whitespace-pre-line">{subtitle}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              type="email"
              required
              className="input"
              placeholder="teacher@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <label className="label" htmlFor="password">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                className="input"
                placeholder="6자 이상"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
          )}
          {err && <p className="text-sm text-red-600 whitespace-pre-line">{err}</p>}
          {msg && <p className="text-sm text-green-600 whitespace-pre-line">{msg}</p>}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={busy || !email || (mode !== "forgot" && !password)}
          >
            {busy ? "처리 중…" : mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : "재설정 메일 보내기"}
          </button>
        </form>

        <div className="flex flex-col items-start gap-1 mt-3">
          {mode !== "signup" && (
            <button
              type="button"
              className="text-sm text-slate-500 underline"
              onClick={() => {
                setMode("signup");
                setErr("");
                setMsg("");
              }}
            >
              계정이 없으신가요? 회원가입
            </button>
          )}
          {mode !== "login" && (
            <button
              type="button"
              className="text-sm text-slate-500 underline"
              onClick={() => {
                setMode("login");
                setErr("");
                setMsg("");
              }}
            >
              이미 계정이 있으신가요? 로그인
            </button>
          )}
          {mode !== "forgot" && (
            <button
              type="button"
              className="text-sm text-slate-500 underline"
              onClick={() => {
                setMode("forgot");
                setErr("");
                setMsg("");
              }}
            >
              비밀번호를 잊으셨나요?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
