import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import InviteForm from "./InviteForm";
import UserRow from "./UserRow";
import KakaoContactForm from "./KakaoContactForm";

export default async function AdminUsersPage() {
  const session = await requireRole("admin");

  const supabase = await createClient();
  // 이름·기수(0021) 열이 아직 없는 DB에서도 목록은 보이도록, 실패하면 예전 열만 다시 읽는다.
  // 과(department, 0033)까지 읽고, 열이 아직 없으면 이름·기수까지만, 그것도 없으면 예전 열만 다시 읽는다.
  let { data: profiles, error } = (await supabase
    .from("profiles")
    .select("id, email, role, created_at, display_name, cohort, department")
    .order("created_at", { ascending: true })) as { data: any[] | null; error: any };
  if (error) {
    ({ data: profiles, error } = (await supabase
      .from("profiles")
      .select("id, email, role, created_at, display_name, cohort")
      .order("created_at", { ascending: true })) as { data: any[] | null; error: any });
  }
  if (error) {
    ({ data: profiles, error } = (await supabase
      .from("profiles")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: true })) as { data: any[] | null; error: any });
  }

  const pendingProfiles = (profiles ?? []).filter((p: any) => p.role === "대기");
  const staffProfiles = (profiles ?? []).filter((p: any) => p.role !== "tutor" && p.role !== "대기");
  const tutorProfiles = (profiles ?? []).filter((p: any) => p.role === "tutor");

  // 2026-09-29: 학번(0036)이 저장된 계정 목록 — 번호는 읽지 않고 누구에게 있는지만(번호는 "보기"를 눌러야 불러옴).
  let studentNoIds: Set<string> | null = null;
  {
    const { data: sn, error: snErr } = (await (supabase.from("student_numbers") as any).select("user_id")) as { data: any[] | null; error: any };
    if (!snErr) studentNoIds = new Set((sn ?? []).map((r: any) => r.user_id));
  }
  const hasNo = (id: string) => (studentNoIds ? studentNoIds.has(id) : undefined);

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

      {pendingProfiles.length > 0 && (
        <div className="card border-amber-300 bg-amber-50">
          <h2 className="font-medium mb-1 text-amber-900">대기중인 계정 ({pendingProfiles.length}명)</h2>
          <p className="text-sm text-amber-800 mb-3">
            직접 회원가입한 계정입니다. 알맞은 권한을 지정해 줄 때까지는 아무 화면도 볼 수 없습니다.
            카카오톡으로 받은 <b>학번(학생증 번호, 예: 2025XXXXXX)</b>을 붙여 넣고 &ldquo;학번 저장하고 과외선생님으로
            승인&rdquo;을 누르면 됩니다(환영 포인트 3P가 함께 들어갑니다). 학번은 관리자만 볼 수 있고, 이미 다른 계정에 등록된
            학번이면 승인되지 않습니다.
          </p>
          <div className="table-wrap">
          <table className="w-full min-w-[30rem] sm:min-w-0 text-sm">
            <thead>
              <tr className="text-left text-amber-700 border-b border-amber-200">
                <th className="py-2 pr-2">과·기수(학번)·이름 / 이메일</th>
                <th className="py-2 pr-2">권한</th>
                <th className="py-2 pr-2">가입일</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {pendingProfiles.map((p: any) => (
                <UserRow key={p.id} profile={p} isMe={p.id === session.userId} approveAsTutor hasStudentNo={hasNo(p.id)} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <KakaoContactSection />

      <div className="card">
        <h2 className="font-medium mb-3">직원 계정 ({staffProfiles.length}명)</h2>
        {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        <div className="table-wrap">
        <table className="w-full min-w-[30rem] sm:min-w-0 text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-2">과·기수(학번)·이름 / 이메일</th>
              <th className="py-2 pr-2">권한</th>
              <th className="py-2 pr-2">가입일</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {staffProfiles.map((p: any) => (
              <UserRow key={p.id} profile={p} isMe={p.id === session.userId} hasStudentNo={hasNo(p.id)} />
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">과외선생님 계정 ({tutorProfiles.length}명)</h2>
        {tutorProfiles.length === 0 ? (
          <p className="text-sm text-slate-500">아직 초대한 과외선생님이 없습니다.</p>
        ) : (
          <div className="table-wrap">
          <table className="w-full min-w-[30rem] sm:min-w-0 text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">과·기수(학번)·이름 / 이메일 / 활동</th>
                <th className="py-2 pr-2">권한</th>
                <th className="py-2 pr-2">가입일</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {tutorProfiles.map((p: any) => (
                <UserRow key={p.id} profile={p} isMe={p.id === session.userId} tutorStats={tutorStatsById[p.id]} hasStudentNo={hasNo(p.id)} />
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

// 2026-09-29: 대기 화면에 띄울 원장님 카카오톡 연락처(0033 site_contact). 표가 없으면(0033 전) 안내만.
async function KakaoContactSection() {
  const supabase = await createClient();
  const { data, error } = (await supabase.from("site_contact").select("kakao_id, kakao_url, kakao_qr, note").maybeSingle()) as any;
  return (
    <div className="card">
      <h2 className="font-medium mb-1">대기 계정 안내용 카카오톡 오픈채팅</h2>
      <p className="text-sm text-slate-500 mb-3">
        회원가입 후 대기 중인 사람에게 &ldquo;가입 정보를 원장님 오픈채팅으로 보내 주세요&rdquo;라는 안내와 함께 이 오픈채팅 링크·QR이 보입니다.
      </p>
      {error ? (
        <p className="text-sm text-amber-700">0033 SQL을 실행하면 여기서 설정할 수 있습니다.</p>
      ) : (
        <KakaoContactForm initial={{ kakao_id: data?.kakao_id ?? "", kakao_url: data?.kakao_url ?? "", kakao_qr: data?.kakao_qr ?? "", note: data?.note ?? "" }} />
      )}
    </div>
  );
}
