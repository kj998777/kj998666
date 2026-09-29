import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import SignOutButton from "./SignOutButton";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자", viewer: "뷰어" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // 로그인 안 했으면 /login 으로, profiles 행이 없으면(=아직 초대 안 받음) 여기서 막힘
  const session = await requireRole("viewer");

  // 관리자에게만: 회원가입 후 승인을 기다리는 계정 수(2026-09-28 원장님 요청 2) — "계정 관리" 옆 숫자
  let pendingCount = 0;
  // 관리자에게만: 새로 들어온(접수) 과외선생님 버그 신고 수(2026-09-29, 0026 전이면 0)
  let bugCount = 0;
  if (session.role === "admin") {
    // 두 숫자를 동시에 조회(2026-09-29 최적화 — 전에는 차례로 조회)
    const supabase = await createClient();
    const [pendingRes, bugRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "대기"),
      Promise.resolve(
        (createAdminClient().from("bug_reports") as any).select("id", { count: "exact", head: true }).eq("status", "접수")
      ).catch(() => ({ count: 0, error: true })),
    ]);
    pendingCount = pendingRes.count ?? 0;
    bugCount = (bugRes as any).error ? 0 : (bugRes as any).count ?? 0;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        {/* 휴대폰(좁은 화면): 1줄 = 로고 + 권한·로그아웃, 2줄 = 메뉴(많으면 줄을 바꿔 전부 보임).
            넓은 화면: 지금처럼 한 줄. 예전에는 한 줄에 모두 넣어 휴대폰에서 메뉴 글자가 한 글자씩
            줄바꿈되고 화면이 옆으로 넘쳐 글자 크기가 들쭉날쭉해 보였다. */}
        <div className="mx-auto max-w-5xl px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link href="/dashboard" className="flex items-center gap-2 sm:gap-3 shrink-0 text-sm">
            <span className="brand-mark">메딕차트</span>
            <span className="hidden sm:block w-px h-4 bg-slate-300" />
            <img src="/academy-logo.png" alt="메딕수학 로고" className="h-4 w-auto" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3 text-sm text-slate-500 sm:order-3">
            <span className="badge bg-slate-100 text-slate-700 whitespace-nowrap hidden sm:inline-flex">
              {ROLE_LABEL[session.role]}
            </span>
            <span className="hidden md:inline">{session.email}</span>
            <SignOutButton />
          </div>
          <nav className="order-last sm:order-2 w-full sm:w-auto sm:flex-1 sm:px-2 flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap py-1.5 text-sm font-medium text-slate-700">
            <Link href="/exams" className="nav-link">시험·정답</Link>
            <Link href="/classes" className="nav-link">반 관리</Link>
            {session.role === "admin" && (
              <Link href="/admin/users" className="nav-link">
                계정 관리
                {pendingCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-700 text-white text-[11px] leading-none min-w-[1.1rem] h-[1.1rem] px-1 align-middle">
                    {pendingCount}
                  </span>
                )}
              </Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/ai" className="nav-link">AI 설정</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/review-status" className="nav-link">검토현황</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/ops" className="nav-link">운영 현황</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/tutor-disputes" className="nav-link">과외 검토 분쟁</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/bug-reports" className="nav-link">
                버그 신고
                {bugCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-700 text-white text-[11px] leading-none min-w-[1.1rem] h-[1.1rem] px-1 align-middle">
                    {bugCount}
                  </span>
                )}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
