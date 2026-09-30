import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/profile/label";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자", viewer: "뷰어" };

// 2026-09-29 원장님 요청: 홈 화면 바로가기가 초기 버전(시험·반·계정 3개)에 머물러 있어, 상단 메뉴와
// 같은 순서로 전부 보이게 하고 관리자에게는 지금 손봐야 할 숫자(검수대기 시험·검토 불일치·승인 대기)를 붙였다.
// 숫자 조회가 실패해도(마이그레이션 전 등) 카드는 그대로 보이고 숫자만 빠진다.

type Card = { href: string; title: string; desc: string; badge?: string | null; tone?: "amber" | "red" };

async function headCount(q: any): Promise<number | null> {
  try {
    const { count, error } = await q;
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const session = await requireRole("viewer");
  const supabase = await createClient();
  const isAdmin = session.role === "admin";

  // 인사말용 이름(기수·이름, 0021 이전이면 이메일)
  let me: { display_name?: string | null; cohort?: string | null; email?: string | null } = { email: session.email };
  {
    const { data, error } = (await supabase
      .from("profiles")
      .select("display_name, cohort")
      .eq("id", session.userId)
      .maybeSingle()) as { data: any; error: any };
    if (!error && data) me = { ...me, ...data };
  }

  // 관리자: 승인을 기다리는 회원가입 계정(2026-09-28). 이름·기수(0021) 열이 아직 없으면 이메일만.
  let pending: { id: string; email: string; display_name?: string | null; cohort?: string | null }[] = [];
  let reviewExams: number | null = null;
  let disputes: number | null = null;
  let bugs: number | null = null;
  let adminStage: number | null = null;
  let staleSecond: number | null = null;
  if (isAdmin) {
    let { data, error } = (await supabase
      .from("profiles")
      .select("id, email, display_name, cohort")
      .eq("role", "대기")
      .order("created_at", { ascending: false })) as { data: any[] | null; error: any };
    if (error) {
      ({ data } = (await supabase.from("profiles").select("id, email").eq("role", "대기")) as { data: any[] | null; error: any });
    }
    pending = data ?? [];

    [reviewExams, disputes, bugs, adminStage, staleSecond] = await Promise.all([
      headCount(supabase.from("exams").select("id", { count: "exact", head: true }).eq("status", "검수대기")),
      headCount(
        (supabase.from("tutor_item_reviews") as any)
          .select("id", { count: "exact", head: true })
          .eq("kind", "primary")
          .eq("verified", true)
          .eq("resolved", false)
      ),
      // 과외선생님 버그 신고(0026, 서비스롤 전용 표) 중 새로 들어온 것
      headCount((createAdminClient().from("bug_reports") as any).select("id", { count: "exact", head: true }).eq("status", "접수")),
      // 0037 다수결: 셋 다 달라 원장님이 정해야 하는 문항(열이 없으면 null → 배지 안 보임)
      headCount((supabase.from("item_explanations") as any).select("id", { count: "exact", head: true }).eq("review_stage", "admin")),
      // 다른 선생님 판정을 3일 넘게 기다리는 문항(처음 제출 시각 기준) — 검토현황의 주황색 표시와 같은 기준
      headCount(
        (supabase.from("tutor_item_reviews") as any)
          .select("id, item_explanations!inner(review_stage)", { count: "exact", head: true })
          .eq("kind", "primary")
          .eq("needs_verification", true)
          .eq("verified", false)
          .eq("item_explanations.review_stage", "second")
          .lt("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
      ),
    ]);
  }

  const cards: Card[] = [
    {
      href: "/exams",
      title: "시험·정답",
      desc: "시험지 PDF를 올려 AI로 정답·해설을 만들고, 정답·해설을 고치고, 채점 결과와 성적 보고서·전체 해설지 PDF를 받습니다.",
    },
    {
      href: "/classes",
      title: "반 관리",
      desc: "학생이 제출 화면에서 고를 학교급·학년·반 목록을 관리합니다. 과외선생님 학생 제출은 \"과외 반\"에 모여 있습니다.",
    },
    {
      href: "/students",
      title: "학생 분석",
      desc: "학생별 시험 점수 추이, 영역·단원별 정답률, 우선 복습할 단원과 다시 풀 문항을 보고 학부모 상담용 누적 보고서 PDF를 받습니다.",
    },
  ];
  if (isAdmin || session.role === "editor") {
    cards.push({
      href: "/bank",
      title: "문항 은행",
      desc: "모든 시험의 문항을 단원·난이도·학교·글자로 찾아 담고, 새 시험지 PDF와 정답·해설지 PDF를 만듭니다(원래 시험지 모양 그대로).",
    });
  }
  if (isAdmin) {
    cards.push(
      {
        href: "/admin/users",
        title: "계정 관리",
        desc: "회원가입 승인, 권한(관리자·편집자·뷰어·과외선생님) 지정, 직원·과외선생님 초대.",
        badge: pending.length ? `승인 대기 ${pending.length}명` : null,
        tone: "amber",
      },
      {
        href: "/admin/ai",
        title: "AI 설정",
        desc: "API 키·모델 선택, 크레딧 사용량, 업로드 처리·디지털화 진행 상황, 문항 영역 찾기 상태.",
      },
      {
        href: "/admin/review-status",
        title: "검토현황",
        desc: "검수대기 시험의 문항별 검토 상태와 맡은 과외선생님을 보고, 문제를 보며 직접 정답·해설을 등록합니다.",
        badge:
          [adminStage ? `원장님 판정 ${adminStage}문항` : null, staleSecond ? `판정 3일+ 대기 ${staleSecond}문항` : null, reviewExams ? `검수대기 시험 ${reviewExams}개` : null]
            .filter(Boolean)
            .join(" · ") || null,
        tone: adminStage || staleSecond ? "red" : "amber",
      },
      {
        href: "/admin/ops",
        title: "운영 현황",
        desc: "과외선생님 검토·포인트·기출 구매 흐름, 선생님별 활동·신뢰도, 정기 백업 다운로드.",
      },
      {
        href: "/admin/tutor-disputes",
        title: "과외 검토 분쟁",
        desc: "사후 검증에서 처음 제출과 다른 답이 나온 문항을 비교하고 확정합니다.",
        badge: disputes ? `확인할 불일치 ${disputes}건` : null,
        tone: "red",
      },
      {
        href: "/admin/bug-reports",
        title: "버그 신고",
        desc: "과외선생님이 보낸 버그 신고를 보고 처리 상태와 답변을 남깁니다(답변은 선생님 화면에 보임).",
        badge: bugs ? `새 신고 ${bugs}건` : null,
        tone: "red",
      }
    );
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
        <h1 className="text-lg font-semibold mb-1">안녕하세요, {personLabel(me) || session.email}님</h1>
        <p className="text-sm text-slate-500">
          현재 권한: <strong>{ROLE_LABEL[session.role] ?? session.role}</strong>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card hover:border-slate-400 flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{c.title}</h2>
              {c.badge && (
                <span
                  className={
                    "badge " + (c.tone === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")
                  }
                >
                  {c.badge}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
