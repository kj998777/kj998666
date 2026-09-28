import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tickExamJob } from "@/lib/ai/pipeline";
import { isActiveStage } from "@/lib/ai/job";
import { tickLocateJobs } from "@/lib/ai/locate";

// 외부 무료 크론 서비스(cron-job.org 등)가 주기적으로 이 엔드포인트를 호출해서, 브라우저 탭을
// 열어두지 않아도 AI 시험 자동처리(exam_jobs)가 계속 한 걸음씩 진행되게 한다.
// 기존에는 app/(staff)/exams/ai-actions.ts의 pollAiJob()을 AiJobPanel.tsx가 4초마다 호출하는
// 방식뿐이어서, 그 화면을 담당 선생님이 계속 열어두고 있어야만 처리가 이어졌다(탭을 닫으면 멈춤).
export const dynamic = "force-dynamic";

// Vercel Hobby 플랜의 서버리스 함수 실행 제한(기본 10초, 최대 60초)을 고려해, 한 번의 크론 호출
// 안에서 여러 시험을 순회하되 일정 시간이 지나면 더 진행하지 않고 다음 크론 주기로 넘긴다.
const TIME_BUDGET_MS = 45_000;

// 아무나 이 URL을 호출해서 AI 처리를 마구 트리거하지 못하도록, Vercel 환경변수로 심어둔 비밀값과
// 대조한다. 비밀값 자체가 설정돼 있지 않으면(아직 배포 전 등) 안전하게 항상 거부한다.
function checkSecret(request: Request): boolean {
  const secret = process.env.AI_CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const provided = request.headers.get("x-cron-secret") ?? url.searchParams.get("secret") ?? "";
  return provided === secret;
}

async function handle(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ ok: false, msg: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("exam_jobs")
    .select("exam_id, stage")
    .in("stage", ["upload", "extract_submit", "extract_wait", "solve_submit", "solve_wait"])
    .order("updated_at", { ascending: true })
    .limit(30);

  if (error) {
    return NextResponse.json({ ok: false, msg: error.message }, { status: 500 });
  }

  const started = Date.now();
  const results: { examId: string; stage: string }[] = [];
  for (const j of jobs ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      // minIntervalMs=0: 사람이 화면을 보며 4초마다 누르는 폴링과 달리, 크론은 호출 자체가
      // 드문드문 일어나므로(수 분 간격) 매번 즉시 한 걸음 진행시켜도 안전하다.
      const updated = await tickExamJob(admin, j.exam_id, 0);
      if (updated) results.push({ examId: j.exam_id, stage: updated.stage });
    } catch {
      // tickExamJob이 이미 자체적으로 오류를 저장하고 'error' 단계로 넘기므로, 여기서는 이
      // 시험 하나가 실패해도 나머지 시험들의 tick을 계속 진행하기 위해 그냥 넘어간다.
    }
  }

  const stillActive = results.filter((r) => isActiveStage(r.stage as any)).length;

  // 문항 잘라 보기 영역 다시 찾기(lib/ai/locate.ts, 0024) — 남은 시간 안에서만. 0024 전이면 아무것도 안 함.
  let located = 0;
  try {
    located = await tickLocateJobs(admin, started + TIME_BUDGET_MS);
  } catch {
    /* 다음 크론 주기에 다시 */
  }
  return NextResponse.json({ ok: true, checked: jobs?.length ?? 0, ticked: results.length, stillActive, located });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
