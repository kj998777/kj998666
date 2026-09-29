import { requireTutor } from "@/lib/auth/requireTutor";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUG_STATUS_BADGE, isMissingTable, type BugReport } from "@/lib/bugs";
import BugReportForm from "./BugReportForm";

export const dynamic = "force-dynamic";

// 과외선생님 "버그 신고" 탭(2026-09-29 원장님 요청). 위에서 신고를 보내고, 아래에서 내가 보낸 신고의
// 처리 상태와 원장님 답변을 본다. bug_reports(0026)는 서비스롤 전용이라 본인 것만 reporter_id로 걸러 읽는다.
// ?from=<화면 이름>을 붙여 들어오면 "어느 화면" 칸에 미리 채운다.

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function TutorBugsPage({ searchParams }: { searchParams: { from?: string } }) {
  const session = await requireTutor();
  const admin = createAdminClient();
  const { data, error } = (await (admin.from("bug_reports") as any)
    .select("id, category, title, body, page_hint, photo_path, status, admin_note, created_at, updated_at")
    .eq("reporter_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(50)) as { data: BugReport[] | null; error: any };
  const notReady = !!error && isMissingTable(error);
  const reports = data ?? [];
  const from = typeof searchParams.from === "string" ? searchParams.from.slice(0, 200) : undefined;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="card space-y-1">
        <h1 className="text-lg font-semibold">버그 신고</h1>
        <p className="text-sm text-slate-500">
          화면이 이상하거나, 버튼이 안 눌리거나, 문제·해설이 잘못 보이거나, 포인트·구매가 이상하면 여기로 알려 주세요.
          원장님이 확인하고 처리 상태와 답변을 아래 목록에 남깁니다. 문항의 정답·해설 자체를 고쳐야 할 때는 구매한 시험의
          &ldquo;해설·정답 수정 요청&rdquo; 탭을 쓰면 더 빨리 반영됩니다.
        </p>
      </div>

      {notReady ? (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
          버그 신고 기능이 아직 준비 중입니다. 급한 일은 원장님께 직접 연락해 주세요.
        </div>
      ) : (
        <BugReportForm defaultPage={from} />
      )}

      <div className="space-y-2">
        <h2 className="font-medium">내가 보낸 신고</h2>
        {error && !notReady && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">아직 보낸 신고가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="card space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{r.title}</div>
                  <span className={"badge " + (BUG_STATUS_BADGE[r.status] ?? "bg-slate-100 text-slate-600")}>{r.status}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {r.category} · {fmt(r.created_at)}
                  {r.page_hint ? ` · ${r.page_hint}` : ""}
                </div>
                {r.photo_path && (
                  <a href={`/bug-photo/${r.id}`} target="_blank" rel="noreferrer" className="text-xs link-accent">
                    첨부한 스크린샷 보기
                  </a>
                )}
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.body}</p>
                {r.admin_note && (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    <b>원장님 답변</b> · {r.admin_note}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
