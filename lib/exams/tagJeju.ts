import "server-only";
import { detectJejuSchool } from "@/lib/jejuSchools";

// 시험을 만든 직후 이름으로 "제주 학교" 여부(exams.is_jeju)를 표시하고, 학교급이 비어 있으면 그 학교의
// 학교급으로 채운다(검토 문항 배정 우선순위용 — supabase/migrations/0019). 시험 생성 insert와 따로 하는
// 이유: 0019 적용 전 DB에는 is_jeju 열이 없어 insert 자체가 실패하면 안 되므로, 여기서만 조용히 실패한다.
export async function tagJejuSchool(client: any, examId: string, name: string, level: string | null): Promise<void> {
  const d = detectJejuSchool(name);
  const patch: Record<string, unknown> = { is_jeju: d.jeju };
  if (!level && d.level) patch.school_level = d.level;
  try {
    await (client.from("exams") as any).update(patch).eq("id", examId);
  } catch {
    /* 무시 — 시험 상세에서 직접 바꿀 수 있음 */
  }
}
