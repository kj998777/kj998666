import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLASSIFY_CHUNK, classifyItems } from "@/lib/ai/classify";
import { LOGIC_SUBJECTS } from "@/lib/similar/logicTypes";

// 유형 분류 탭(/admin/logic-types)의 "AI로 분류" 한 걸음 — 시험 하나에서 유형이 빈 문항을 최대 CLASSIFY_CHUNK개 골라
// AI로 분류해 저장하고, 남은 수를 돌려준다. 화면이 남은 문항이 없을 때까지(또는 더 못 정할 때까지) 다시 부른다.
// 서버 액션이 아니라 API 라우트인 이유: 실행 시간(maxDuration)을 지정하고, 화면의 다른 버튼을 붙잡지 않으려고
// (review-status/locate-tick과 같은 이유).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  let body: { examId?: unknown; subject?: unknown; skip?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const examId = String(body.examId ?? "");
  const subject = String(body.subject ?? "");
  const skip = Array.isArray(body.skip) ? body.skip.map(String).filter((x) => UUID_RE.test(x)).slice(0, 500) : [];
  if (!UUID_RE.test(examId) || !LOGIC_SUBJECTS[subject]) return Response.json({ ok: false, msg: "시험이나 과목이 올바르지 않습니다." }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: rows }, { data: keys }] = await Promise.all([
    admin.from("item_explanations").select("id, item_label, unit, problem_statement, solution").eq("exam_id", examId).is("logic_type", null),
    admin.from("answer_key").select("item_label, sort_order").eq("exam_id", examId),
  ]);
  const sortOf = new Map(((keys as any[]) ?? []).map((k) => [String(k.item_label), Number(k.sort_order) || 0]));
  const all = ((rows as any[]) ?? [])
    .filter((r) => !skip.includes(r.id)) // 이번 실행에서 AI가 못 정한 문항은 다시 보내지 않음
    .sort((a, b) => (sortOf.get(String(a.item_label)) ?? 0) - (sortOf.get(String(b.item_label)) ?? 0));
  const chunk = all.slice(0, CLASSIFY_CHUNK);
  if (!chunk.length) return Response.json({ ok: true, saved: 0, missed: [], left: 0 });

  const r = await classifyItems(
    admin,
    chunk.map((x) => ({ id: x.id, label: String(x.item_label), unit: x.unit ?? "", statement: x.problem_statement ?? "", solution: x.solution ?? "" })),
    subject
  );
  if (!r.ok) return Response.json({ ok: false, msg: r.msg }, { status: 502 });
  let saved = 0;
  for (const [id, lt] of Object.entries(r.result)) {
    const { error } = await admin.from("item_explanations").update({ logic_type: lt }).eq("id", id).eq("exam_id", examId).is("logic_type", null);
    if (!error) saved++;
  }
  const missed = chunk.filter((x) => !r.result[x.id]).map((x) => x.id);
  return Response.json({ ok: true, saved, missed, left: all.length - chunk.length });
}
