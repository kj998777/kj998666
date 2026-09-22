import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import InviteForm from "./InviteForm";
import UserRow from "./UserRow";
import type { Role } from "@/lib/supabase/types";

export default async function AdminUsersPage() {
  const session = await requireRole("admin");

  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">계정 관리</h1>
        <p className="text-sm text-slate-500">
          후배·동료 선생님을 초대하고 뷰어/편집자/관리자 권한을 정합니다. 편집자는 시험·정답
          등록과 반 관리, 채점 결과 확인까지 가능하고, 시험 열기/닫기와 계정 관리는 관리자만
          할 수 있습니다.
        </p>
      </div>

      <div className="card max-w-md">
        <h2 className="font-medium mb-3">새 계정 초대</h2>
        <InviteForm />
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">전체 계정 ({profiles?.length ?? 0}명)</h2>
        {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-2">이메일</th>
              <th className="py-2 pr-2">권한</th>
              <th className="py-2 pr-2">가입일</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p: { id: string; email: string; role: Role; created_at: string }) => (
              <UserRow key={p.id} profile={p} isMe={p.id === session.userId} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
