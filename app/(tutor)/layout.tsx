import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/app/(staff)/SignOutButton";

// 과외선생님 전용 트랙 — admin/editor/viewer 계층(app/(staff)/layout.tsx)과 완전히 분리된 화면.
// requireTutor()는 requireRole() 계층을 전혀 쓰지 않으므로, 직원 화면 URL을 직접 쳐도 이 레이아웃
// 자체는 아무 보호도 해 주지 않는다(그건 (staff) 레이아웃의 requireRole("viewer") 몫) — 반대로
// 직원 계정으로 /tutor/* 를 열면 여기서 곧바로 막힌다.
export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireTutor();

  const supabase = await createClient();
  const { data: stats } = await supabase
    .from("tutor_stats")
    .select("points_balance")
    .eq("tutor_id", session.userId)
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-700">
            <Link href="/tutor/dashboard" className="font-semibold text-slate-900">
              과외선생님
            </Link>
            <Link href="/tutor/review">검토하기</Link>
            <Link href="/tutor/store">기출 스토어</Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="badge bg-amber-100 text-amber-700">
              포인트 {(stats as any)?.points_balance ?? 0}
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
