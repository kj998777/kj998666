import "server-only";
import type { ExamJobStage } from "@/lib/supabase/types";

// exam_jobs 테이블 읽기/쓰기 도우미. Apps Script의 '자동처리' 시트(jobGet_/jobSet_/jobAll_)에 대응.
// 시트는 한 시험당 여러 줄이 쌓일 수 있었지만(재시작 시 새 줄), 여기서는 exam_id를 기본키로 두고
// 매번 upsert해서 항상 최신 상태 한 줄만 유지한다(이력이 필요 없으므로 더 단순함).
//
// 참고(project doc "새-website-v1"): 이 프로젝트의 손으로 쓴 Database 타입 + 지금 버전의
// supabase-js 조합에서 .update()/.insert()/.upsert() 인자가 이유 없이 never 로 추론되는 문제가
// 실제 Vercel 빌드를 여러 번 실패시켰다. 그 교훈에 따라 쓰기 계열 호출은 전부 (client.from(x) as any)
// 로 빌더 자체를 캐스팅하고, single()/maybeSingle() 결과도 await 표현식을 as any 로 받는다.
//
// 그리고 이후(2026-09) Client 타입 자체도 any로 바꿨다: lib/supabase/server.ts의 createClient()가
// 돌려주는 @supabase/ssr의 createServerClient<Database>() 결과가, 여기서 쓰던
// @supabase/supabase-js의 SupabaseClient<Database> 타입과 대입이 안 되는 실제 빌드 실패를 겪었기
// 때문 — 두 패키지가 내부적으로 서로 다른 타입 인스턴스를 만들어내는 것으로 보인다.

export type JobState = Record<string, any>;
export type Job = { examId: string; stage: ExamJobStage; message: string; state: JobState; updatedAt: string };

type Client = any;

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
    // updated_at을 직접 넣는다(2026-09-29): 이 표에는 자동 갱신 트리거가 없어서, 지금까지 updated_at이 처음 만든
    // 시각에서 멈춰 있었다 → tick의 "너무 잦은 호출 막기"가 사실상 꺼져 있었고, AI 설정 화면의 "갱신 n분 전"과
    // 크론의 "오래 기다린 것부터" 순서도 실제와 달랐다.
    { exam_id: examId, stage, message: message.slice(0, 500), state: state ?? {}, updated_at: new Date().toISOString() },
    { onConflict: "exam_id" }
  );
  if (error) throw error;
}

/**
 * 작업 한 걸음을 "내가 맡았다"고 표시한다(2026-09-29). 성공하면 true — 그때만 단계 함수를 실행한다.
 *
 * 왜 필요한가: 같은 작업을 여러 곳이 동시에 진행시킨다(1분마다 도는 크론, 시험 화면의 4초 폴링, AI 설정 화면의 폴링,
 * 탭을 여러 개 열어 둔 경우). 두 호출이 같은 단계(예: 풀이 요청)를 동시에 읽으면 둘 다 AI에 배치를 보내, 같은 문항을
 * 두 번 풀게 되고(크레딧 두 배) 뒤에 쓴 배치 번호가 앞의 것을 덮어쓴다. 문항 영역 찾기에서 실제로 재현된 문제와 같은 구조.
 *
 * 방식: 읽어 온 그 상태(updated_at) 그대로일 때만 state.lease(맡은 시각 + LEASE_MS)를 써 넣는다. 다른 호출은 lease가
 * 살아 있으면 건너뛴다. 단계 함수가 끝나며 저장(setJob 등)할 때 lease를 뺀 상태를 쓰므로 자연히 풀린다. 도중에 서버
 * 실행이 끊겨도 LEASE_MS가 지나면 다시 진행된다.
 */
export const LEASE_MS = 5 * 60_000;

export async function claimJobLease(
  client: Client,
  table: "exam_jobs" | "digitize_jobs" | "item_checks",
  match: Record<string, string>,
  row: { updatedAt: string; state: JobState }
): Promise<boolean> {
  const lease = Number(row.state?.lease || 0);
  if (lease > Date.now()) return false;
  const state = { ...(row.state || {}), lease: Date.now() + LEASE_MS };
  let q = (client.from(table) as any).update({ state, updated_at: new Date().toISOString() });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = (await q.eq("updated_at", row.updatedAt).select(Object.keys(match)[0])) as any;
  if (error) return false;
  if (!Array.isArray(data) || !data.length) return false; // 그사이 다른 호출이 먼저 바꿈
  if (row.state) delete row.state.lease; // 이 호출이 이어서 저장할 상태에는 lease를 넣지 않는다(저장하면 곧 풀림)
  return true;
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
