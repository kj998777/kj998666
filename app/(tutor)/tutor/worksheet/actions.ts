"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 과외선생님 맞춤 시험지 만들기(2026-09-30). 고를 수 있는 문항인지·값·포인트 차감은 DB 함수(tutor_create_worksheet, 0042)가 한 번에 한다.
export async function createTutorWorksheet(ids: string[], title: string): Promise<{ ok: boolean; id?: string; cost?: number; msg?: string }> {
  await requireTutor();
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x))));
  if (!clean.length) return { ok: false, msg: "문항을 먼저 담아 주세요." };
  if (clean.length > 30) return { ok: false, msg: "한 번에 30문항까지 만들 수 있습니다." };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("tutor_create_worksheet", { p_item_ids: clean, p_title: String(title ?? "").slice(0, 60) });
  if (error) {
    const m = String(error.message || "");
    if (/function .*tutor_create_worksheet|does not exist/i.test(m)) return { ok: false, msg: "아직 준비 중인 기능입니다(원장님이 0042를 적용하면 쓸 수 있어요)." };
    return { ok: false, msg: m };
  }
  revalidatePath("/tutor/worksheet");
  revalidatePath("/tutor/dashboard");
  return { ok: true, id: data?.id, cost: Number(data?.cost ?? 0) };
}

/** 담은 문항 목록에 보여 줄 짧은 정보(시험·번호·단원·난이도) — 정답·해설은 없음 */
export async function tutorCartInfo(
  ids: string[]
): Promise<{ id: string; examId: string; examName: string; label: string; unit: string; difficulty: string }[]> {
  await requireTutor();
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))).slice(0, 30);
  if (!clean.length) return [];
  const admin = createAdminClient() as any;
  const { data: rows } = await admin.from("item_explanations").select("id, exam_id, item_label, unit, difficulty").in("id", clean);
  const examIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.exam_id)));
  const { data: exams } = examIds.length
    ? await admin.from("exams").select("id, name, status, tutor_download_cost").in("id", examIds)
    : { data: [] };
  // 스토어에 없는 시험(검토 중·판매 안 함)의 문항은 알려 주지 않는다
  const ok = new Map(((exams as any[]) ?? []).filter((e) => e.status !== "검수대기" && e.tutor_download_cost != null).map((e) => [e.id, e.name]));
  const by = new Map(((rows as any[]) ?? []).filter((r) => ok.has(r.exam_id)).map((r) => [r.id, r]));
  return clean
    .map((id) => by.get(id))
    .filter(Boolean)
    .map((r: any) => ({ id: r.id, examId: r.exam_id, examName: String(ok.get(r.exam_id) ?? ""), label: String(r.item_label), unit: String(r.unit ?? ""), difficulty: String(r.difficulty ?? "") }));
}
