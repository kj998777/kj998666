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

  const staffProfiles = (profiles ?? []).filter((p: any) => p.role !== "tutor");
  const tutorProfiles = (profiles ?? []).filter((p: any) => p.role === "tutor");

  let tutorStatsById: Record<string, { points_balance: number; reviews_submitted: number; reviews_flagged: number }> = {};
  if (tutorProfiles.length > 0) {
    const { data: stats } = await supabase
      .from("tutor_stats")
      .select("tutor_id, points_balance, reviews_submitted, reviews_flagged")
      .in("tutor_id", tutorProfiles.map((p: any) => p.id));
    for (const s of (stats as any[]) ?? []) tutorStatsById[s.tutor_id] = s;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">계정 관리</h1>
        <p className="text-sm text-slate-500">
          후배·동료 선생님을 초대하고 뷰어/편집자/관리자 권한을 정합니다. 편집자는 시험·정답
          등록과 반 관리, 채점 결과 확인까지 가능하고, 시험 열기/닫기와 계정 관리는 관리자만
          할 수 있습니다. 과외선생님은 별개 트랙으로, 검토대기 문항을 풀어 포인트를 벌고 그
          포인트로 기출문제를 다운로드하는 화면만 볼 수 있습니다(직원 화면은 볼 수 없음).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="font-medium mb-3">직원 계정 초대</h2>
          <InviteForm defaultRole="viewer" />
        </div>
        <div className="card border-sky-200">
          <h2 className="font-medium mb-3">과외선생님 초대</h2>
          <InviteForm defaultRole="tutor" />
        </div>
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">직원 계정 ({staffProfiles.length}명)</h2>
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
            {staffProfiles.map((p: { id: string; email: string; role: Role; created_at: string }) => (
              <UserRow key={p.id} profile={p} isMe={p.id === session.userId} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">과외선생님 계정 ({tutorProfiles.length}명)</h2>
        {tutorProfiles.length === 0 ? (
          <p className="text-sm text-slate-500">아직 초대한 과외선생님이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">이메일 / 활동</th>
                <th className="py-2 pr-2">권한</th>
                <th className="py-2 pr-2">가입일</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {tutorProfiles.map((p: { id: string; email: string; role: Role; created_at: string }) => (
                <UserRow key={p.id} profile={p} isMe={p.id === session.userId} tutorStats={tutorStatsById[p.id]} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
