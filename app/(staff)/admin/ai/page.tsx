import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getAiSettingsPublic, getCreditInfo } from "@/lib/ai/settings";
import { countMissingLocateItems, countRecheck, countStaleDigitized } from "@/lib/ai/locate";
import AiSettingsForm from "./AiSettingsForm";
import CreditPanel from "./CreditPanel";
import UploadStatusPanel, { type UploadJobRow } from "./UploadStatusPanel";
import LocateStatusPanel, { type LocateJobRow } from "./LocateStatusPanel";

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

  const missingItems = await countMissingLocateItems(supabase);
  const stale = await countStaleDigitized(supabase).catch(() => ({ exams: 0, items: 0 }));
  const recheck = await countRecheck(supabase).catch(() => ({ exams: 0, items: 0 }));

  const examIds = [...new Set(jobs.map((j) => j.exam_id))];
  const examById = new Map<string, any>();
  if (examIds.length) {
    const { data: examsRaw } = (await supabase.from("exams").select("id, code, name").in("id", examIds)) as any;
    for (const e of (examsRaw as any[]) ?? []) examById.set(e.id, e);
  }
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

export default async function AdminAiPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [settings, credit, examJobs, digitizeJobs, locate] = await Promise.all([
    getAiSettingsPublic(supabase),
    getCreditInfo(supabase),
    loadExamJobs(supabase),
    loadDigitizeJobs(supabase),
    loadLocate(supabase),
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
        <LocateStatusPanel
          available={locate.available}
          missingItems={locate.missingItems}
          jobs={locate.jobs}
          stale={locate.stale}
          recheck={locate.recheck}
        />
      </div>
    </div>
  );
}
