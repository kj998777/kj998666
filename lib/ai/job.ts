import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExamJobStage } from "@/lib/supabase/types";

// exam_jobs 테이블 읽기/쓰기 도우미. Apps Script의 '자동처리' 시트(jobGet_/jobSet_/jobAll_)에 대응.
// 시트는 한 시험당 여러 줄이 쌓일 수 있었지만(재시작 시 새 줄), 여기서는 exam_id를 기본키로 두고
// 매번 upsert해서 항상 최신 상태 한 줄만 유지한다(이력이 필요 없으므로 더 단순함).
//
// 참고(project doc "새-website-v1"): 이 프로젝트의 손으로 쓴 Database 타입 + 지금 버전의
// supabase-js 조합에서 .update()/.insert()/.upsert() 인자가 이유 없이 never 로 추론되는 문제가
// 실제 Vercel 빌드를 여러 번 실패시켰다. 그 교훈에 따라 쓰기 계열 호출은 전부 (client.from(x) as any)
// 로 빌더 자체를 캐스팅하고, single()/maybeSingle() 결과도 await 표현식을 as any 로 받는다.

export type JobState = Record<string, any>;
export type Job = { examId: string; stage: ExamJobStage; message: string; state: JobState; updatedAt: string };

type Client = SupabaseClient<Database>;

export async function getJob(client: Client, examId: string): Promise<Job | null> {
  const { data, error } = (await client.from("exam_jobs").select("*").eq("exam_id", examId).maybeSingle()) as any;
  if (error) throw error;
  if (!data) return null;
  return { examId: data.exam_id, stage: data.stage, message: data.message, state: data.state, updatedAt: data.updated_at };
}

export async function setJob(
  client: Client,
  examId: string,
  stage: ExamJobStage,
  message: string,
  state: JobState
): Promise<void> {
  const json = JSON.stringify(state ?? {});
  if (json.length > 200000) throw new Error("작업 상태가 너무 커서 저장하지 못했습니다.");
  const { error } = await (client.from("exam_jobs") as any).upsert(
    { exam_id: examId, stage, message: message.slice(0, 500), state: state ?? {} },
    { onConflict: "exam_id" }
  );
  if (error) throw error;
}

export async function deleteJob(client: Client, examId: string): Promise<void> {
  await client.from("exam_jobs").delete().eq("exam_id", examId);
}

const ACTIVE_STAGES: ExamJobStage[] = [
  "upload",
  "extract_submit",
  "extract_wait",
  "solve_submit",
  "solve_wait",
];

export function isActiveStage(stage: ExamJobStage): boolean {
  return ACTIVE_STAGES.includes(stage);
}
