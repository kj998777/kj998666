"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

        {sent ? (
          <div className="text-sm">
            <p className="mb-2">
              <strong>{email}</strong> 주소로 로그인 링크를 보냈습니다.
            </p>
            <p className="text-slate-500">메일함(스팸함 포함)을 확인해서 링크를 눌러 주세요.</p>
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
