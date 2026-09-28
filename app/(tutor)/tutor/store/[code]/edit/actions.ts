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

  // 실제 있는 문항인지 확인(과외선생님은 정답표 RLS를 통과 못 하므로 서비스롤로 조회만)
  const admin = createAdminClient() as any;
  const { data: key } = await admin.from("answer_key").select("id").eq("exam_id", exam.id).eq("item_label", itemLabel).maybeSingle();
  if (!key) return { ok: false, msg: "문항을 찾을 수 없습니다." };

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
