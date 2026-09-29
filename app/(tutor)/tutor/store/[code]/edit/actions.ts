"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPurchasedExam } from "@/lib/tutor/purchased";

// #4: 과외선생님 해설·정답 수정 요청(원장님 결정: 원본에 바로 반영하지 않고 관리자가 검토현황에서 확정).
export async function submitEditRequest(
  code: string,
  itemLabel: string,
  fields: { answer: string; solution: string; note: string }
): Promise<{ ok: boolean; msg?: string }> {
  const session = await requireTutor();
  const exam = await getPurchasedExam(session.userId, code);
  if (!exam) return { ok: false, msg: "구매한 시험이 아닙니다." };

  const answer = fields.answer.trim().slice(0, 200);
  const solution = fields.solution.trim().slice(0, 4000);
  const note = fields.note.trim().slice(0, 1000);
  if (!answer && !solution && !note) return { ok: false, msg: "고칠 정답·해설이나 메모 중 하나는 적어 주세요." };
  // 0037 정답 이의제기: 정답을 바꾸자는 요청은 근거(풀이나 메모 10자 이상)가 꼭 있어야 한다
  if (answer && solution.length < 10 && note.length < 10) {
    return { ok: false, msg: "정답을 바꾸자는 요청은 근거가 필요해요. 풀이나 메모에 왜 그 답인지 10자 이상 적어 주세요." };
  }

  // 실제 있는 문항인지 확인(과외선생님은 정답표 RLS를 통과 못 하므로 서비스롤로 조회만)
  const admin = createAdminClient() as any;
  const { data: key } = await admin.from("answer_key").select("id").eq("exam_id", exam.id).eq("item_label", itemLabel).maybeSingle();
  if (!key) return { ok: false, msg: "문항을 찾을 수 없습니다." };

  // 0037: 하루 3건까지, 최근 30일에 반영 안 된 요청이 3건 이상이면 잠시 제한
  const dayStart = new Date(Date.now() + 9 * 3600_000); // 한국 시각 기준 오늘 0시
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = new Date(dayStart.getTime() - 9 * 3600_000).toISOString();
  const month = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ count: today }, { count: rejected }] = await Promise.all([
    admin.from("tutor_edit_requests").select("id", { count: "exact", head: true }).eq("tutor_id", session.userId).gte("created_at", since),
    admin
      .from("tutor_edit_requests")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", session.userId)
      .eq("status", "rejected")
      .gte("resolved_at", month),
  ]);
  if ((today ?? 0) >= 3) return { ok: false, msg: "수정 요청은 하루 3건까지 보낼 수 있어요. 내일 다시 보내 주세요." };
  if ((rejected ?? 0) >= 3) {
    return { ok: false, msg: "최근 30일 동안 반영되지 않은 요청이 3건 이상이라 잠시 요청을 보낼 수 없어요. 궁금한 점은 원장님께 문의해 주세요." };
  }

  const supabase = await createClient();
  const { data: dup } = await (supabase.from("tutor_edit_requests") as any)
    .select("id")
    .eq("exam_id", exam.id)
    .eq("item_label", itemLabel)
    .eq("tutor_id", session.userId)
    .eq("status", "pending")
    .maybeSingle();
  if (dup) return { ok: false, msg: "이 문항에 이미 확인을 기다리는 요청이 있습니다." };

  // 쓰기는 과외선생님 세션으로(RLS가 "본인·구매한 시험·대기 상태"만 허용)
  const { error } = await (supabase.from("tutor_edit_requests") as any).insert({
    exam_id: exam.id,
    item_label: itemLabel,
    tutor_id: session.userId,
    proposed_answer: answer,
    proposed_solution: solution,
    note,
  });
  if (error) return { ok: false, msg: "요청을 올리지 못했습니다: " + error.message };

  revalidatePath(`/tutor/store/${encodeURIComponent(exam.code)}/edit`);
  revalidatePath("/admin/review-status");
  return { ok: true };
}
