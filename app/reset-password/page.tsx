"use client";

// 비밀번호 재설정 메일의 링크를 클릭하면(→ /auth/callback → 여기) 도착하는 화면.
// 이 시점에는 이미 임시 로그인 세션이 있는 상태이므로, updateUser로 새 비밀번호만 설정하면 된다.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setErr("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr("비밀번호를 설정하지 못했습니다: " + error.message);
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">새 비밀번호 설정</h1>
        <p className="text-sm text-slate-500 mb-4">앞으로 로그인할 때 사용할 비밀번호를 정해 주세요.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="password">
              새 비밀번호
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
              autoComplete="new-password"
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
            {busy ? "저장 중…" : "비밀번호 저장"}
          </button>
        </form>
      </div>
    </div>
  );
}
