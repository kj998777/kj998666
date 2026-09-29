import { Suspense } from "react";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getAiSettingsPublic, getCreditInfo } from "@/lib/ai/settings";
import { countMissingLocateItems, countRecheck, countStaleDigitized } from "@/lib/ai/locate";
import AiSettingsForm from "./AiSettingsForm";
import CreditPanel from "./CreditPanel";
import UploadStatusPanel, { type UploadJobRow } from "./UploadStatusPanel";
import LocateStatusPanel, { type LocateJobRow } from "./LocateStatusPanel";
import QrScanPanel from "./QrScanPanel";
import { getQrScanSummary } from "@/lib/ai/qrMask";
import { createAdminClient } from "@/lib/supabase/admin";

// AI 자동 처리(exam_jobs)와 디지털화(digitize_jobs) 중 아직 끝나지 않은 것들을 모아 온다.
// review(검수대기) 단계는 시험 목록 폴더 트리의 "검수대기" 표시와 중복되므로 여기서는 뺀다.
async function loadExamJobs(supabase: any): Promise<UploadJobRow[]> {
  const { data: jobsRaw } = (await supabase
    .from("exam_jobs")
    .select("exam_id, stage, message, updated_at")
    .neq("stage", "done")
    .neq("stage", "review")
    .order("updated_at", { ascending: false })) as any;
  const jobs = (jobsRaw as any[]) ?? [];
  if (jobs.length === 0) return [];

  const examIds = [...new Set(jobs.map((j) => j.exam_id))];
  const { data: examsRaw } = (await supabase.from("exams").select("id, code, name").in("id", examIds)) as any;
  const examById = new Map(((examsRaw as any[]) ?? []).map((e) => [e.id, e]));

  return jobs
    .map((j) => {
      const exam = examById.get(j.exam_id);
      if (!exam) return null;
      return { code: exam.code, name: exam.name, stage: j.stage, message: j.message, updatedAt: j.updated_at };
    })
    .filter((r: UploadJobRow | null): r is UploadJobRow => r !== null);
}

async function loadDigitizeJobs(supabase: any): Promise<UploadJobRow[]> {
  const { data: jobsRaw } = (await supabase
    .from("digitize_jobs")
    .select("exam_id, stage, message, updated_at")
    .neq("stage", "dg_done")
    .order("updated_at", { ascending: false })) as any;
  const jobs = (jobsRaw as any[]) ?? [];
  if (jobs.length === 0) return [];

  const examIds = [...new Set(jobs.map((j) => j.exam_id))];
  const { data: examsRaw } = (await supabase.from("exams").select("id, code, name").in("id", examIds)) as any;
  const examById = new Map(((examsRaw as any[]) ?? []).map((e) => [e.id, e]));

  return jobs
    .map((j) => {
      const exam = examById.get(j.exam_id);
      if (!exam) return null;
      return { code: exam.code, name: exam.name, stage: j.stage, message: j.message, updatedAt: j.updated_at };
    })
    .filter((r: UploadJobRow | null): r is UploadJobRow => r !== null);
}

// 문항 영역 찾기(item_locate_jobs, 0024) — 시험별 작업 전부 + 좌표 없는 검토 대기 문항 수. 0024 전이면 available=false.
async function loadLocate(
  supabase: any
): Promise<{
  available: boolean;
  missingItems: number;
  jobs: LocateJobRow[];
  stale: { exams: number; items: number };
  recheck: { exams: number; items: number };
}> {
  const { data: jobsRaw, error } = (await supabase
    .from("item_locate_jobs")
    .select("exam_id, stage, message, attempts, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(300)) as any;
  if (error) return { available: false, missingItems: 0, jobs: [], stale: { exams: 0, items: 0 }, recheck: { exams: 0, items: 0 } };
  const jobs = (jobsRaw as any[]) ?? [];

  // 2026-09-29 최적화: 세 가지 집계와 시험 이름 조회를 차례로가 아니라 동시에 한다.
  const examIds = [...new Set(jobs.map((j) => j.exam_id))];
  const [missingItems, stale, recheck, examsRes] = await Promise.all([
    countMissingLocateItems(supabase).catch(() => 0),
    countStaleDigitized(supabase).catch(() => ({ exams: 0, items: 0 })),
    countRecheck(supabase).catch(() => ({ exams: 0, items: 0 })),
    examIds.length
      ? (supabase.from("exams").select("id, code, name").in("id", examIds) as any)
      : Promise.resolve({ data: [] }),
  ]);
  const examById = new Map<string, any>();
  for (const e of ((examsRes as any)?.data as any[]) ?? []) examById.set(e.id, e);
  return {
    available: true,
    missingItems,
    stale,
    recheck,
    jobs: jobs.map((j) => {
      const e = examById.get(j.exam_id);
      return {
        examId: j.exam_id,
        code: e?.code ?? null,
        name: e?.name ?? "(삭제된 시험)",
        stage: j.stage,
        message: j.message ?? "",
        attempts: j.attempts ?? 0,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
      };
    }),
  };
}

// 문항 영역 찾기 칸은 집계가 가장 무거워서 따로 불러온다 — 나머지 화면이 먼저 뜨고 이 칸은 준비되는 대로 채워진다(2026-09-29 최적화).
async function LocateSection() {
  const supabase = await createClient();
  const locate = await loadLocate(supabase);
  return (
    <LocateStatusPanel
      available={locate.available}
      missingItems={locate.missingItems}
      jobs={locate.jobs}
      stale={locate.stale}
      recheck={locate.recheck}
    />
  );
}

// 원본 속 QR 가리기 현황(0031) — 나머지 화면이 먼저 뜨고 채워진다
async function QrSection() {
  const s = await getQrScanSummary(createAdminClient()).catch(() => null);
  return (
    <QrScanPanel
      s={s ?? { available: false, pdfExams: 0, done: 0, withQr: 0, qrCount: 0, pending: 0, error: 0, notScanned: 0 }}
    />
  );
}

function LocateFallback() {
  return (
    <div className="space-y-2 animate-pulse">
      <h2 className="font-medium">문항 영역 찾기</h2>
      <p className="text-sm text-slate-400">진행 상황을 불러오는 중…</p>
      <div className="h-4 w-2/3 rounded bg-slate-100" />
      <div className="h-4 w-1/2 rounded bg-slate-100" />
    </div>
  );
}

export default async function AdminAiPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [settings, credit, examJobs, digitizeJobs] = await Promise.all([
    getAiSettingsPublic(supabase),
    getCreditInfo(supabase),
    loadExamJobs(supabase),
    loadDigitizeJobs(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">AI 설정</h1>
        <p className="text-sm text-slate-500">
          시험지 자동 처리(문항 추출·풀이·검수)에 쓰는 Anthropic API 키·모델과 크레딧 사용량을 관리합니다.
        </p>
      </div>

      <div className="card max-w-lg">
        <h2 className="font-medium mb-3">API 키 · 모델</h2>
        <AiSettingsForm initial={settings} />
      </div>

      <div className="card max-w-lg">
        <h2 className="font-medium mb-3">크레딧 사용량</h2>
        <CreditPanel initial={credit} />
      </div>

      <div className="card">
        <UploadStatusPanel initialExamJobs={examJobs} initialDigitizeJobs={digitizeJobs} />
      </div>

      <div className="card">
        <Suspense fallback={<LocateFallback />}>
          <LocateSection />
        </Suspense>
      </div>

      <div className="card">
        <Suspense fallback={<p className="text-sm text-slate-400">원본 속 QR 가리기 현황을 불러오는 중…</p>}>
          <QrSection />
        </Suspense>
      </div>
    </div>
  );
}
