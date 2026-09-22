import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const session = await requireRole("viewer");

  return (
    <div className="space-y-4">
      {searchParams.denied && (
        <div className="card border-amber-300 bg-amber-50 text-amber-800 text-sm">
          그 화면을 볼 권한이 없어서 대시보드로 돌아왔습니다.
        </div>
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
