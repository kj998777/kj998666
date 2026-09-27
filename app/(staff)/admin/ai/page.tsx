import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getAiSettingsPublic, getCreditInfo } from "@/lib/ai/settings";
import AiSettingsForm from "./AiSettingsForm";
import CreditPanel from "./CreditPanel";
import UploadStatusPanel, { type UploadJobRow } from "./UploadStatusPanel";

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
    </div>
  );
}
