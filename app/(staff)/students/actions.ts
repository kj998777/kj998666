"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { autoKey, makeResolver, type KeyRow } from "@/lib/students/analysis";
import { loadStudentIndex } from "@/lib/students/load";

// 학생 분석(0039 student_keys): 합치기·풀기·숨기기·상담 메모. 편집자 이상(RLS도 is_editor_or_admin).

const KEY_RE = /^(반|과외):.+\|.+/;
function validKey(k: unknown): k is string {
  return typeof k === "string" && k.length >= 3 && k.length <= 200 && KEY_RE.test(k);
}

type Res = { ok: true } | { ok: false; msg: string };
const NO_TABLE = "학생 분석용 SQL(0039)을 먼저 실행해 주세요.";

async function readRows(supabase: any): Promise<{ rows: KeyRow[]; error: any }> {
  const { data, error } = await (supabase.from("student_keys") as any).select("key, merged_into, hidden, memo").order("key").limit(20000);
  return { rows: ((data as any[]) ?? []).map((r) => ({ key: r.key, merged_into: r.merged_into ?? null, hidden: !!r.hidden, memo: r.memo ?? "" })), error };
}

function done() {
  revalidatePath("/students");
  revalidatePath("/students/[key]", "page");
}

/** from 묶음을 into 학생에 합친다(from에 이미 합쳐져 있던 묶음도 같이 옮김). */
export async function mergeStudents(fromKey: string, intoKey: string): Promise<Res> {
  const session = await requireRole("editor");
  if (!validKey(fromKey) || !validKey(intoKey)) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const supabase = await createClient();
  const { rows, error } = await readRows(supabase);
  if (error) return { ok: false, msg: NO_TABLE };
  const resolve = makeResolver(rows);
  const from = resolve(fromKey);
  const into = resolve(intoKey);
  if (from === into) return { ok: false, msg: "이미 같은 학생입니다." };

  const now = new Date().toISOString();
  const fromRow = rows.find((r) => r.key === from);
  const intoRow = rows.find((r) => r.key === into);
  // 상담 메모: 합쳐지는 쪽에만 있으면 옮기고, 둘 다 있으면 이어 붙인다
  const memo = [intoRow?.memo?.trim(), fromRow?.memo?.trim()].filter(Boolean).join("\n\n").slice(0, 4000);
  const up = await (supabase.from("student_keys") as any).upsert(
    [
      { key: from, merged_into: into, hidden: fromRow?.hidden ?? false, memo: "", updated_at: now, updated_by: session.userId },
      { key: into, merged_into: null, hidden: intoRow?.hidden ?? false, memo, updated_at: now, updated_by: session.userId },
    ],
    { onConflict: "key" }
  );
  if (up.error) return { ok: false, msg: "합치지 못했습니다: " + up.error.message };
  // from 아래에 있던 묶음들도 바로 into를 가리키게(사슬을 한 단계로)
  const moved = await (supabase.from("student_keys") as any)
    .update({ merged_into: into, updated_at: now, updated_by: session.userId })
    .eq("merged_into", from);
  if (moved.error) return { ok: false, msg: "합치지 못했습니다: " + moved.error.message };
  done();
  return { ok: true };
}

/** 합쳐 둔 묶음 하나를 다시 따로 떼어 낸다 */
export async function unmergeStudent(memberKey: string): Promise<Res> {
  const session = await requireRole("editor");
  if (!validKey(memberKey)) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const supabase = await createClient();
  const r = await (supabase.from("student_keys") as any)
    .update({ merged_into: null, updated_at: new Date().toISOString(), updated_by: session.userId })
    .eq("key", memberKey);
  if (r.error) return { ok: false, msg: NO_TABLE };
  done();
  return { ok: true };
}

export async function setStudentHidden(key: string, hidden: boolean): Promise<Res> {
  const session = await requireRole("editor");
  if (!validKey(key)) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const supabase = await createClient();
  const r = await (supabase.from("student_keys") as any).upsert(
    { key, hidden: !!hidden, updated_at: new Date().toISOString(), updated_by: session.userId },
    { onConflict: "key" }
  );
  if (r.error) return { ok: false, msg: NO_TABLE };
  done();
  return { ok: true };
}

export async function saveStudentMemo(key: string, memo: string): Promise<Res> {
  const session = await requireRole("editor");
  if (!validKey(key)) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const text = String(memo ?? "").replace(/\r\n/g, "\n").slice(0, 4000);
  const supabase = await createClient();
  const r = await (supabase.from("student_keys") as any).upsert(
    { key, memo: text, updated_at: new Date().toISOString(), updated_by: session.userId },
    { onConflict: "key" }
  );
  if (r.error) return { ok: false, msg: NO_TABLE };
  revalidatePath("/students/[key]", "page");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 2026-10-03 원장님: "학생 삭제 기능도 추가". 학생의 제출(submissions)을 지우면 채점 결과(grading_results)는
// on delete cascade로 같이 지워진다. 되돌릴 수 없으므로 관리자만(RLS submissions_delete_admin_only도 관리자만),
// 화면에서는 학생 이름을 다시 입력해야 버튼이 눌린다.
// ---------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function doneDelete() {
  done();
  revalidatePath("/classes", "layout");
  revalidatePath("/exams/[code]/results", "page");
}

/** 학생(합쳐 둔 묶음 포함)이 낸 제출을 모두 지운다. 지운 제출 수를 돌려준다. */
export async function deleteStudent(key: string): Promise<{ ok: true; n: number } | { ok: false; msg: string }> {
  await requireRole("admin");
  if (!validKey(key)) return { ok: false, msg: "학생을 찾지 못했습니다." };
  const supabase = await createClient();
  const idx = await loadStudentIndex(supabase);
  const resolve = makeResolver(idx.keyRows);
  const target = resolve(key);
  const ids = idx.subs.filter((s) => resolve(autoKey(s)) === target).map((s) => s.id);
  if (!ids.length) return { ok: false, msg: "지울 제출이 없습니다(이미 지워졌을 수 있어요)." };
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("submissions").delete().in("id", ids.slice(i, i + 200));
    if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  }
  // 합치기·숨기기·상담 메모 기록도 정리(0039 전이면 표가 없어 그냥 넘어감)
  const members = idx.keyRows.filter((r) => r.key === target || resolve(r.key) === target).map((r) => r.key);
  if (members.length) await (supabase.from("student_keys") as any).delete().in("key", members);
  doneDelete();
  return { ok: true, n: ids.length };
}

/** 제출 하나만 지운다(잘못 낸 제출 등) */
export async function deleteStudentSubmission(submissionId: string): Promise<Res> {
  await requireRole("admin");
  if (typeof submissionId !== "string" || !UUID_RE.test(submissionId)) return { ok: false, msg: "제출을 찾지 못했습니다." };
  const supabase = await createClient();
  const { error, count } = await (supabase.from("submissions") as any).delete({ count: "exact" }).eq("id", submissionId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  if (!count) return { ok: false, msg: "지울 제출을 찾지 못했습니다(이미 지워졌을 수 있어요)." };
  doneDelete();
  return { ok: true };
}
