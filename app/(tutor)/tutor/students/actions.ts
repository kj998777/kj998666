"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { autoKey } from "@/lib/students/analysis";

// 2026-10-03 원장님: "학생 삭제 기능도 추가" — 과외선생님은 본인 전용 링크로 들어온 제출(submissions.tutor_id = 본인)만 지울 수 있다.
// 과외선생님 세션에는 제출 삭제 RLS가 없으므로, 본인 제출인지 확인한 뒤 서비스롤로 지운다(삭제 조건에도 tutor_id = 본인을 다시 건다).
// 채점 결과(grading_results)는 on delete cascade로 같이 지워진다. 되돌릴 수 없다.

type Res = { ok: true; n?: number } | { ok: false; msg: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function done() {
  revalidatePath("/tutor/students");
  revalidatePath("/tutor/students/[id]", "page");
  revalidatePath("/tutor/store/[code]/results", "page");
}

export async function deleteMyStudent(key: string): Promise<Res> {
  const session = await requireTutor();
  if (typeof key !== "string" || !key.startsWith(`과외:${session.userId}|`) || key.length > 200) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const supabase = await createClient();
  const { data } = await fetchAllPages((a, b) =>
    (supabase.from("submissions") as any).select("id, class_label, student_name, tutor_id").eq("tutor_id", session.userId).order("id").range(a, b)
  );
  const ids = ((data as any[]) ?? []).filter((s) => s.tutor_id === session.userId && autoKey(s) === key).map((s) => s.id as string);
  if (!ids.length) return { ok: false, msg: "지울 제출이 없습니다(이미 지워졌을 수 있어요)." };
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await admin.from("submissions").delete().in("id", ids.slice(i, i + 200)).eq("tutor_id", session.userId);
    if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  }
  done();
  return { ok: true, n: ids.length };
}

export async function deleteMySubmission(submissionId: string): Promise<Res> {
  const session = await requireTutor();
  if (typeof submissionId !== "string" || !UUID_RE.test(submissionId)) return { ok: false, msg: "제출을 찾지 못했습니다." };
  const admin = createAdminClient();
  const { data: row } = await (admin.from("submissions") as any).select("id, tutor_id").eq("id", submissionId).maybeSingle();
  if (!row || row.tutor_id !== session.userId) return { ok: false, msg: "선생님 학생의 제출이 아닙니다." };
  const { error } = await admin.from("submissions").delete().eq("id", submissionId).eq("tutor_id", session.userId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  done();
  return { ok: true };
}
