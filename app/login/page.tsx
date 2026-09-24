"use client";

// 매직 링크(이메일 인증 메일) 방식은 "요청한 브라우저와 클릭한 브라우저가 달라야 실패"하는 PKCE
// 제약과, Resend 무료 발신 주소가 스팸함으로 분류되는 문제가 겹쳐서 로그인이 계속 반복되는
// 것처럼 느껴지는 문제가 있었다. 그래서 이메일+비밀번호 방식으로 전환한다 — 로그인할 때마다
// 이메일을 열어볼 필요가 없어서 이런 문제 자체가 생기지 않는다.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

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

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (error) {
        setErr(
          error.message.includes("Invalid login credentials")
            ? "이메일 또는 비밀번호가 올바르지 않습니다."
            : "로그인하지 못했습니다: " + error.message
        );
        return;
      }
      // 서버 컴포넌트/미들웨어가 새 세션 쿠키를 확실히 읽도록 클라이언트 라우팅 대신
      // 전체 페이지 이동을 사용한다.
      window.location.href = "/dashboard";
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
          ? "이미 가입된 이메일입니다. 로그인해 주세요."
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">
          학원 시험관리 {mode === "login" ? "로그인" : "회원가입"}
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          {mode === "login"
            ? "이메일과 비밀번호로 로그인하세요."
            : "이메일과 비밀번호로 계정을 만드세요."}
        </p>

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
          {err && <p className="text-sm text-red-600 whitespace-pre-line">{err}</p>}
          {msg && <p className="text-sm text-green-600">{msg}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
            {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>

        <button
          type="button"
          className="text-sm text-slate-500 mt-3 underline"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setErr("");
            setMsg("");
          }}
        >
          {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
      </div>
    </div>
  );
}
