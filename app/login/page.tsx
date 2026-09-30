"use client";

// 매직 링크(이메일 인증 메일) 방식은 "요청한 브라우저와 클릭한 브라우저가 달라야 실패"하는 PKCE
// 제약과, Resend 무료 발신 주소가 스팸함으로 분류되는 문제가 겹쳐서 로그인이 계속 반복되는
// 것처럼 느껴지는 문제가 있었다. 그래서 이메일+비밀번호 방식으로 전환한다 — 로그인할 때마다
// 이메일을 열어볼 필요가 없어서 이런 문제 자체가 생기지 않는다. 비밀번호를 잊었거나(또는 예전
// 매직 링크 방식으로만 가입해서 비밀번호가 아예 없는 계정) 재설정이 필요한 경우에만 이메일
// 링크(→ /reset-password)를 한 번 사용한다.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEPARTMENTS, normalizeCohort, normalizeStudentNo, type Department } from "@/lib/profile/label";
import { LEGAL } from "@/lib/legal";

type Mode = "login" | "signup" | "forgot";

// /auth/callback에서 이메일 링크(비밀번호 재설정·가입 확인) 처리가 실패하면 여기로
// ?error=... 를 붙여 돌려보낸다. 예전에는 이 파라미터를 아예 읽지 않아서 사용자가 그냥
// 빈 로그인 화면을 보고 "링크를 눌렀는데 아무 반응이 없다"고 느꼈다(실제로는 그 링크를 요청한
// 것과 다른 기기/브라우저에서 열어서, PKCE 로그인 방식이 요구하는 code_verifier 쿠키가 없어
// 실패한 것 — 이 프로젝트에서 말하는 "쿠키 문제"의 유력한 원인). useEffect+location.search로
// 읽는 이유: 이 페이지는 완전히 클라이언트 컴포넌트라 useSearchParams를 쓰면 Suspense 경계가
// 추가로 필요해지므로, 더 단순한 방식을 쓴다.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  exchange_failed:
    "이메일로 받은 링크를 열지 못했습니다. 링크를 \"요청했던 것과 같은 기기·브라우저\"에서 " +
    "열어야 합니다 (예: 컴퓨터에서 요청하고 휴대폰 메일 앱에서 열면 실패합니다 — 로그인에 쓰는 " +
    "임시 쿠키가 그 브라우저에만 저장되기 때문입니다). 아래에서 다시 요청한 뒤, 그 요청을 보낸 " +
    "바로 이 화면/브라우저에서 메일을 열어 링크를 눌러 주세요.",
  no_code: "로그인 링크가 올바르지 않습니다. 아래에서 다시 요청해 주세요.",
};

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 회원가입 때만: 비밀번호 재확인(2026-09-29 원장님 요청) — 오타로 모르는 비밀번호가 설정되는 일을 막는다
  const [password2, setPassword2] = useState("");
  // 회원가입 때만: 기수·이름(2026-09-28) — 관리자가 계정 관리 화면에서 누구인지 바로 알아보도록
  const [cohort, setCohort] = useState("");
  // 2026-09-29: 과(의대·수의대·약대 — 간호대는 뺌). 의대는 기수, 나머지는 학번(둘 다 cohort 칸에 저장)
  const [department, setDepartment] = useState<Department | "">("");
  const isMed = department === "의대";
  const cohortValue = isMed ? normalizeCohort(cohort) : normalizeStudentNo(cohort);
  const [displayName, setDisplayName] = useState("");
  // 2026-09-30: 개인정보처리방침·이용약관 동의(공개 전 LEGAL.PUBLISHED=false면 칸이 안 보이고 검사도 안 함)
  const [agree, setAgree] = useState(false);
  const needAgree = LEGAL.PUBLISHED;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) {
      setErr(CALLBACK_ERROR_MESSAGES[code] ?? "로그인 링크 처리 중 문제가 발생했습니다: " + code);
      setMode("forgot");
      // 새로고침해도 같은 오류 메시지가 계속 남아있지 않도록 URL에서 파라미터를 지운다.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

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
        else if ((profile as any)?.role === "대기") dest = "/pending";
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
    if (password !== password2) {
      setBusy(false);
      setErr("비밀번호 확인이 일치하지 않습니다. 두 칸에 같은 비밀번호를 입력해 주세요.");
      return;
    }
    if (!department) {
      setBusy(false);
      setErr("과를 골라 주세요.");
      return;
    }
    if (!cohortValue || !displayName.trim()) {
      setBusy(false);
      setErr(isMed ? "기수와 이름을 입력해 주세요." : "학번과 이름을 입력해 주세요.");
      return;
    }
    if (needAgree && !agree) {
      setBusy(false);
      setErr("개인정보 수집·이용과 이용약관에 동의해 주세요.");
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // 이름·기수만 보낸다. 권한(role)은 가입 트리거(0021)가 항상 '대기'로 정하고, 관리자가 승인한다.
      // 동의한 방침 판(version)과 시각은 가입 기록(auth.users의 raw_user_meta_data)에 함께 남는다.
      options: {
        data: {
          display_name: displayName.trim().slice(0, 30),
          cohort: cohortValue,
          department,
          ...(needAgree ? { legal_consent_version: LEGAL.EFFECTIVE_DATE || LEGAL.VERSION, legal_consent_at: new Date().toISOString() } : {}),
        },
      },
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
      // 이메일 확인 절차 없이 바로 로그인된 상태 — 자율 가입 계정은 항상 '대기' 권한으로
      // 시작하므로(#6) 곧장 대기 안내 화면으로 보낸다.
      window.location.href = "/pending";
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
        ? "이메일과 비밀번호로 계정을 만드세요.\n가입 후 관리자가 승인하면 사용할 수 있습니다."
        : "가입할 때 쓴 이메일 주소를 입력하면 재설정 링크를 보내드립니다.";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* 메딕차트(시스템) + 메딕수학(학원) 배너 — 메딕차트를 크게 먼저, 학원 로고는 작게 뒤에 */}
      <div className="flex items-stretch gap-4 mb-6">
        <div className="flex flex-col justify-center">
          <div className="brand-mark text-3xl leading-none">메딕차트</div>
          <p className="text-[11px] tracking-[0.3em] text-slate-400 uppercase mt-1 pl-[calc(1.1em+0.375rem)]">
            Medic Chart
          </p>
        </div>
        <div className="w-px bg-slate-300" />
        <div className="flex items-center">
          <img src="/academy-logo.png" alt="메딕수학 로고" className="h-[34px] w-auto" />
        </div>
      </div>
      <div className="card w-full max-w-sm">
        <h1 className="text-base font-semibold mb-1">{title}</h1>
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
          {mode === "signup" && (
            <div>
              <span className="label">과</span>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${DEPARTMENTS.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="과">
                {DEPARTMENTS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={department === d}
                    className={
                      "rounded-md border px-1 py-2 text-sm " +
                      (department === d ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50")
                    }
                    onClick={() => {
                      if (department !== d) setCohort("");
                      setDepartment(d);
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "signup" && department && (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <div>
                <label className="label" htmlFor="cohort">
                  {isMed ? "기수" : "학번"}
                </label>
                <input
                  id="cohort"
                  required
                  maxLength={isMed ? 10 : 20}
                  inputMode={isMed ? "numeric" : undefined}
                  className="input"
                  placeholder={isMed ? "예: 31" : "예: 21"}
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="displayName">
                  이름
                </label>
                <input
                  id="displayName"
                  required
                  maxLength={30}
                  className="input"
                  placeholder="홍길동"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            </div>
          )}
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
          {mode === "signup" && (
            <div>
              <label className="label" htmlFor="password2">
                비밀번호 확인
              </label>
              <input
                id="password2"
                type="password"
                required
                minLength={6}
                className="input"
                placeholder="비밀번호를 한 번 더 입력"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
              {password2 && password !== password2 && (
                <p className="text-xs text-red-600 mt-1">비밀번호가 일치하지 않습니다.</p>
              )}
              {password2 && password === password2 && (
                <p className="text-xs text-green-600 mt-1">비밀번호가 일치합니다.</p>
              )}
            </div>
          )}
          {mode === "signup" && needAgree && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                (필수){" "}
                <a href="/privacy" target="_blank" className="link-accent">
                  개인정보 수집·이용
                </a>
                과{" "}
                <a href="/terms" target="_blank" className="link-accent">
                  이용약관
                </a>
                을 읽었고 동의합니다.
              </span>
            </label>
          )}
          {err && <p className="text-sm text-red-600 whitespace-pre-line">{err}</p>}
          {msg && <p className="text-sm text-green-600 whitespace-pre-line">{msg}</p>}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={
              busy || !email || (mode !== "forgot" && !password) || (mode === "signup" && (!department || !cohort.trim() || !displayName.trim() || !password2 || password !== password2 || (needAgree && !agree)))
            }
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
        {LEGAL.PUBLISHED && (
          <p className="mt-4 text-xs text-slate-400">
            <a href="/privacy" className="hover:underline">
              개인정보처리방침
            </a>{" "}
            ·{" "}
            <a href="/terms" className="hover:underline">
              이용약관
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

