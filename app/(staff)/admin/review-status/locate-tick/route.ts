import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { tickLocateJobs } from "@/lib/ai/locate";

// 문항 영역 찾기(lib/ai/locate.ts) 한 걸음 진행 — 검토현황 화면(LocatePanel)이 열려 있는 동안 주기적으로 부른다.
//
// 2026-09-29: 전에는 이 일을 서버 액션(pollLocateItems)으로 했는데, 서버 액션은 한 화면에서 하나씩 차례로만
// 실행돼서 이 확인(최대 20초 넘게)이 도는 동안 같은 화면의 "확정" 같은 버튼이 줄 서서 기다렸고, 검토현황
// 화면에는 실행 시간 설정(maxDuration)도 없어 제출 도중 끊길 수 있었다. 일반 API 라우트로 옮기고 시간을 명시한다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const processed = await tickLocateJobs(admin, Date.now() + 40_000);
  const { data } = (await admin.from("item_locate_jobs").select("exam_id, stage, message").order("exam_id")) as any;
  const rows: any[] = data ?? [];
  const active = rows.filter((r) => r.stage === "submit" || r.stage === "wait").length;
  // 화면은 이 값이 바뀌었을 때만 새로고침한다(바뀐 게 없는데 무거운 검토현황 화면을 매번 다시 그리지 않도록).
  const sig = rows.map((r) => `${r.exam_id}:${r.stage}:${r.message}`).join("|");
  return Response.json({ ok: true, processed, active, sig: String(sig.length) + ":" + hash(sig) });
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
