"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  no_code: "로그인 링크가 올바르지 않습니다. 이메일에서 링크를 다시 눌러 주세요.",
  exchange_failed:
    "로그인 링크 처리에 실패했습니다. 가장 흔한 원인은 이메일을 입력해 링크를 요청한 것과 " +
    "다른 브라우저(또는 다른 기기, 시크릿 창)에서 링크를 열었기 때문입니다. " +
    "이메일 주소를 입력했던 것과 같은 브라우저/탭에서 이메일의 링크를 열어 주세요. " +
    "그래도 안 되면 로그인을 다시 요청해서 새 링크로 시도해 주세요(오래된 링크는 사용할 수 없습니다).",
};

function LoginError() {
  const params = useSearchParams();
  const code = params.get("error");
  if (!code) return null;
  const msg = ERROR_MESSAGES[code] ?? "로그인 중 문제가 발생했습니다. 다시 시도해 주세요.";
  return <p className="text-sm text-red-600 mb-3 whitespace-pre-line">{msg}</p>;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setErr("로그인 메일을 보내지 못했습니다: " + error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">학원 시험관리 로그인</h1>
        <p className="text-sm text-slate-500 mb-4">
          미리 초대받은 이메일 주소로만 로그인할 수 있습니다.
        </p>

        <Suspense fallback={null}>
          <LoginError />
        </Suspense>

        {sent ? (
          <div className="text-sm">
            <p className="mb-2">
              <strong>{email}</strong> 주소로 로그인 링크를 보냈습니다.
            </p>
            <p className="text-slate-500">
              메일함(스팸함 포함)을 확인해서 링크를 눌러 주세요. 지금 이 화면을 보고 있는 것과
              같은 브라우저에서 링크를 열어야 합니다(다른 기기나 앱으로 열면 실패할 수 있습니다).
            </p>
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
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
              />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy || !email}>
              {busy ? "보내는 중…" : "로그인 링크 받기"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
