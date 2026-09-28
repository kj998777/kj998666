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
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-700">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="brand-mark">메딕차트</span>
              <span className="w-px h-4 bg-slate-300" />
              <img src="/academy-logo.png" alt="메딕수학 로고" className="h-4 w-auto" />
            </Link>
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
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="badge bg-slate-100 text-slate-700">
              {ROLE_LABEL[session.role]}
            </span>
            <span>{session.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
