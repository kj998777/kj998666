import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/profile/label";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const session = await requireRole("viewer");

  // 관리자: 승인을 기다리는 회원가입 계정(2026-09-28). 이름·기수(0021) 열이 아직 없으면 이메일만.
  let pending: { id: string; email: string; display_name?: string | null; cohort?: string | null }[] = [];
  if (session.role === "admin") {
    const supabase = await createClient();
    let { data, error } = (await supabase
      .from("profiles")
      .select("id, email, display_name, cohort")
      .eq("role", "대기")
      .order("created_at", { ascending: false })) as { data: any[] | null; error: any };
    if (error) {
      ({ data } = (await supabase.from("profiles").select("id, email").eq("role", "대기")) as { data: any[] | null; error: any });
    }
    pending = data ?? [];
  }

  return (
    <div className="space-y-4">
      {searchParams.denied && (
        <div className="card border-amber-300 bg-amber-50 text-amber-800 text-sm">
          그 화면을 볼 권한이 없어서 대시보드로 돌아왔습니다.
        </div>
      )}

      {pending.length > 0 && (
        <Link href="/admin/users" className="card border-amber-300 bg-amber-50 block hover:border-amber-400">
          <p className="font-medium text-amber-900">승인을 기다리는 계정 {pending.length}명 →</p>
          <p className="text-sm text-amber-800 mt-1">
            {pending
              .slice(0, 5)
              .map((p) => personLabel(p))
              .join(", ")}
            {pending.length > 5 ? ` 외 ${pending.length - 5}명` : ""}
          </p>
        </Link>
      )}

      <div className="card">
        <h1 className="text-lg font-semibold mb-1">안녕하세요, {session.email}님</h1>
        <p className="text-sm text-slate-500">
          현재 권한: <strong>{session.role}</strong>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/exams" className="card hover:border-slate-400">
          <h2 className="font-medium mb-1">시험·정답 관리</h2>
          <p className="text-sm text-slate-500">시험을 만들고 정답을 등록·수정합니다.</p>
        </Link>
        <Link href="/classes" className="card hover:border-slate-400">
          <h2 className="font-medium mb-1">반 관리</h2>
          <p className="text-sm text-slate-500">학생이 제출 화면에서 고를 반 목록을 관리합니다.</p>
        </Link>
        {session.role === "admin" && (
          <Link href="/admin/users" className="card hover:border-slate-400">
            <h2 className="font-medium mb-1">계정 관리</h2>
            <p className="text-sm text-slate-500">동료 선생님 계정을 초대하고 권한을 정합니다.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
