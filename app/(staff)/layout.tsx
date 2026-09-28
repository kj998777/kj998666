import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import SignOutButton from "./SignOutButton";

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자", viewer: "뷰어" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // 로그인 안 했으면 /login 으로, profiles 행이 없으면(=아직 초대 안 받음) 여기서 막힘
  const session = await requireRole("viewer");

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
              <Link href="/admin/users" className="nav-link">계정 관리</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/ai" className="nav-link">AI 설정</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/review-status" className="nav-link">검토현황</Link>
            )}
            {session.role === "admin" && (
              <Link href="/admin/tutor-disputes" className="nav-link">과외 검토 분쟁</Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
