import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { isMissingTable, type BugReport } from "@/lib/bugs";
import BugReportRow, { type AdminBugRow } from "./BugReportRow";

export const dynamic = "force-dynamic";

// 관리자 "버그 신고" 화면(2026-09-29): 과외선생님이 /tutor/bugs에서 보낸 신고를 모아 보고, 처리 상태와 답변을 남긴다.
// 기본은 처리할 것(접수·확인 중)만, "전체"를 누르면 해결·보류까지.

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function AdminBugReportsPage({ searchParams }: { searchParams: { all?: string } }) {
  await requireRole("admin");
  const showAll = searchParams.all === "1";
  const admin = createAdminClient();

  let q = (admin.from("bug_reports") as any)
    .select("id, reporter_id, category, title, body, page_hint, user_agent, photo_path, status, admin_note, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!showAll) q = q.in("status", ["접수", "확인 중"]);
  const { data, error } = (await q) as { data: BugReport[] | null; error: any };

  if (error && isMissingTable(error)) {
    return (
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold">버그 신고</h1>
        <p className="text-sm text-slate-600">
          마이그레이션 <code>0026_bug_reports.sql</code>을 Supabase SQL Editor에서 실행하면 과외선생님 신고를 여기서 볼 수 있습니다.
        </p>
      </div>
    );
  }

  const reports = data ?? [];
  const ids = Array.from(new Set(reports.map((r) => r.reporter_id)));
  const people = new Map<string, string>();
  if (ids.length) {
    let { data: ps, error: pErr } = (await admin.from("profiles").select("id, email, display_name, cohort").in("id", ids)) as any;
    if (pErr) ({ data: ps } = (await admin.from("profiles").select("id, email").in("id", ids)) as any);
    for (const p of (ps as any[]) ?? []) people.set(p.id, personLabel(p));
  }

  // 처리할 것 먼저(접수 → 확인 중 → 보류 → 해결), 같은 상태면 최근 것부터
  const order: Record<string, number> = { 접수: 0, "확인 중": 1, 보류: 2, 해결: 3 };
  const rows: AdminBugRow[] = [...reports]
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.created_at.localeCompare(a.created_at))
    .map((r) => ({
      id: r.id,
      reporter: people.get(r.reporter_id) || "알 수 없는 계정",
      category: r.category,
      title: r.title,
      body: r.body,
      page_hint: r.page_hint,
      user_agent: r.user_agent,
      has_photo: !!r.photo_path,
      status: r.status,
      admin_note: r.admin_note,
      created: fmt(r.created_at),
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">버그 신고</h1>
          <p className="text-sm text-slate-500">
            과외선생님이 &ldquo;버그 신고&rdquo; 탭에서 보낸 내용입니다. 상태와 답변을 저장하면 신고한 선생님 화면에 그대로 보입니다.
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          <Link href="/admin/bug-reports" className={"badge " + (!showAll ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}>
            처리할 것
          </Link>
          <Link href="/admin/bug-reports?all=1" className={"badge " + (showAll ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}>
            전체
          </Link>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">불러오지 못했습니다: {error.message}</p>}
      {rows.length === 0 ? (
        <div className="card text-sm text-slate-500">{showAll ? "아직 들어온 신고가 없습니다." : "지금 처리할 신고가 없습니다."}</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <BugReportRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
