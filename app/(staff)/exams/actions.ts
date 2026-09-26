"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import type { SchoolLevel } from "@/lib/supabase/types";

function schoolLevelField(formData: FormData): SchoolLevel | null {
  const v = String(formData.get("school_level") ?? "").trim();
  return v === "초" || v === "중" || v === "고" ? v : null;
}

export type FolderKind = "중간" | "기말" | "기타";

export type FolderValue = {
  year: string | null;
  grade: number | null;
  term: number | null;
  kind: FolderKind | null;
};

/** 옛 Apps Script의 folderClean_() 와 같은 역할 — 알아볼 수 없는 값은 조용히 미분류(null)로 만든다. */
function cleanFolder(input: FolderValue): FolderValue {
  const year = (input.year ?? "").trim();
  const grade = input.grade;
  const term = input.term;
  const kind = input.kind;
  return {
    year: /^20\d{2}$/.test(year) ? year : null,
    grade: grade === 1 || grade === 2 || grade === 3 ? grade : null,
    term: term === 1 || term === 2 ? term : null,
    kind: kind === "중간" || kind === "기말" || kind === "기타" ? kind : null,
  };
}

/** 새 시험 생성. 처음에는 항상 "닫힘" 상태로 시작 — 정답을 등록한 뒤 관리자가 직접 열어야 한다. */
export async function createExam(formData: FormData) {
  const { userId } = await requireRole("editor");

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!code) return { ok: false, msg: "시험 코드를 입력해 주세요." };
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exams")
    .insert({ code, name, status: "닫힘", created_by: userId, school_level: schoolLevelField(formData) } as any);
  if (error) {
    const msg = error.message.includes("duplicate") || error.code === "23505"
      ? "이미 사용 중인 시험 코드입니다."
      : "만들지 못했습니다: " + error.message;
    return { ok: false, msg };
  }

  revalidatePath("/exams");
  redirect(`/exams/${encodeURIComponent(code)}`);
}

/** 시험의 학교급(중/고 등) 분류를 바꾼다 — 만든 뒤에도 목록에서 다시 지정할 수 있게. */
export async function updateSchoolLevel(code: string, level: SchoolLevel | null) {
  await requireRole("editor");
  const supabase = await createClient();
  const { error } = await (supabase.from("exams") as any).update({ school_level: level }).eq("code", code);
  if (error) return { ok: false, msg: "바꾸지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  revalidatePath("/exams");
  return { ok: true };
}

/** 시험의 폴더 분류(연도·학년·학기·구분)를 바꾼다 — 목록 화면의 폴더 트리를 위한 값. */
export async function updateFolder(code: string, value: FolderValue) {
  await requireRole("editor");
  const clean = cleanFolder(value);
  const supabase = await createClient();
  const { error } = await (supabase.from("exams") as any)
    .update({
      folder_year: clean.year,
      folder_grade: clean.grade,
      folder_term: clean.term,
      folder_kind: clean.kind,
    })
    .eq("code", code);
  if (error) return { ok: false, msg: "바꾸지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  revalidatePath("/exams");
  return { ok: true };
}

/** 시험 자체 삭제(정답·제출·채점 결과까지 전부 함께 삭제됨) — 관리자 전용. */
export async function deleteExam(examId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("exams").delete().eq("id", examId);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath("/exams");
  return { ok: true };
}
