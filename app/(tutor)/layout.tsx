import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/app/(staff)/SignOutButton";
import { getMyActiveClaims } from "@/lib/tutor/claims";

// 과외선생님 전용 트랙 — admin/editor/viewer 계층(app/(staff)/layout.tsx)과 완전히 분리된 화면.
// requireTutor()는 requireRole() 계층을 전혀 쓰지 않으므로, 직원 화면 URL을 직접 쳐도 이 레이아웃
// 자체는 아무 보호도 해 주지 않는다(그건 (staff) 레이아웃의 requireRole("viewer") 몫) — 반대로
// 직원 계정으로 /tutor/* 를 열면 여기서 곧바로 막힌다.
export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireTutor();

  const supabase = await createClient();
  // 포인트와 "맡은 문제" 숫자(지금 배정받아 풀고 있는 문항 수)를 동시에 조회(2026-09-29 최적화)
  const [{ data: stats }, claimCount] = await Promise.all([
    supabase.from("tutor_stats").select("points_balance").eq("tutor_id", session.userId).maybeSingle(),
    getMyActiveClaims(session.userId)
      .then((c) => c.length)
      .catch(() => 0),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        {/* 휴대폰(좁은 화면): 1줄 = 로고 + 포인트·로그아웃, 2줄 = 메뉴. 넓은 화면은 한 줄(직원 화면과 같은 방식). */}
        <div className="mx-auto max-w-5xl px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link href="/tutor/dashboard" className="flex items-center gap-2 sm:gap-3 shrink-0 text-sm">
            <span className="brand-mark">메딕차트</span>
            <span className="hidden sm:block w-px h-4 bg-slate-300" />
            <img src="/academy-logo.png" alt="메딕수학 로고" className="h-4 w-auto" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3 text-sm text-slate-500 sm:order-3">
            <span className="badge bg-amber-100 text-amber-700 whitespace-nowrap">
              포인트 {(stats as any)?.points_balance ?? 0}
            </span>
            <span className="hidden md:inline">{session.email}</span>
            <SignOutButton />
          </div>
          <nav className="order-last sm:order-2 w-full sm:w-auto sm:flex-1 sm:px-2 flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap py-1.5 text-sm font-medium text-slate-700">
            <span className="hidden sm:inline text-slate-300">·</span>
            <span className="hidden sm:inline text-slate-500 text-sm">과외선생님</span>
            <Link href="/tutor/review" className="nav-link">검토하기</Link>
            <Link href="/tutor/assigned" className="nav-link">
              맡은 문제
              {claimCount > 0 && <span className="ml-1 badge bg-red-100 text-red-700">{claimCount}</span>}
            </Link>
            <Link href="/tutor/store" className="nav-link">기출 스토어</Link>
            <Link href="/tutor/guide" className="nav-link">사용법</Link>
            <Link href="/tutor/bugs" className="nav-link">버그 신고</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
