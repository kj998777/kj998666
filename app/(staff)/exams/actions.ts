"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import type { SchoolLevel } from "@/lib/supabase/types";
import { tagJejuSchool } from "@/lib/exams/tagJeju";
import { folderLabel, guessFolder } from "@/lib/exams/guessFolder";

function schoolLevelField(formData: FormData): SchoolLevel | null {
  const v = String(formData.get("school_level") ?? "").trim();
  return v === "중" || v === "고" ? v : null; // 2026-10-03: 초등학교는 뺌
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

  // 한글을 표준형(NFC)으로 — 맥 파일 이름의 분해형(NFD)이면 글자 검색·제주 판정이 안 된다(2026-09-29)
  const code = String(formData.get("code") ?? "").normalize("NFC").trim();
  const name = String(formData.get("name") ?? "").normalize("NFC").trim();
  if (!code) return { ok: false, msg: "시험 코드를 입력해 주세요." };
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };

  const supabase = await createClient();
  // 2026-10-03: 학교급을 안 골랐으면, 그리고 폴더 칸은 항상 시험 이름·코드에서 읽어 자동으로 채운다(lib/exams/guessFolder.ts)
  const guessed = guessFolder(name, code);
  const level = schoolLevelField(formData) ?? guessed.school_level;
  const { data: created, error } = (await supabase
    .from("exams")
    .insert({ code, name, status: "닫힘", created_by: userId, ...guessed, school_level: level } as any)
    .select("id")
    .single()) as any;
  if (!error && created) await tagJejuSchool(supabase, created.id, name, level);
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

/** 제주도 내 학교 시험인지 표시를 바꾼다 — 검토 문항 배정 때 제주 학교 문제가 먼저 나간다(0019). */
export async function updateExamJeju(code: string, jeju: boolean) {
  await requireRole("editor");
  const supabase = await createClient();
  const { error } = await (supabase.from("exams") as any).update({ is_jeju: jeju }).eq("code", code);
  if (error) {
    const msg = /is_jeju/.test(error.message)
      ? "데이터베이스 마이그레이션 0019가 아직 적용되지 않았습니다."
      : "바꾸지 못했습니다: " + error.message;
    return { ok: false, msg };
  }
  revalidatePath(`/exams/${code}`);
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

/**
 * 2026-09-29 원장님 요청(제주 자동분류 개선): 넓힌 판별 규칙(lib/jejuSchools.ts)으로 모든 시험을 다시 판정한다.
 * 제주로 판정되는 시험만 "제주"로 켜고(학교급이 비어 있으면 채움), 이미 켜진 시험·원장님이 직접 바꾼 표시는 끄지 않는다.
 * 결과로 이번에 바뀐 시험과, 여전히 "타 지역"으로 남은 시험 이름을 돌려준다(화면에서 확인·직접 수정용).
 */
export async function retagJejuExams(): Promise<
  | { ok: true; changed: { code: string; name: string }[]; remaining: { code: string; name: string }[] }
  | { ok: false; msg: string }
> {
  await requireRole("admin");
  const { detectJejuSchool } = await import("@/lib/jejuSchools");
  const { fetchAllPages } = await import("@/lib/supabase/fetchAll");
  const supabase = await createClient();
  const { data, error } = await fetchAllPages((f, t) =>
    (supabase.from("exams") as any).select("id, code, name, is_jeju, school_level").order("id").range(f, t)
  );
  if (error) {
    return {
      ok: false,
      msg: /is_jeju/.test(String(error.message)) ? "데이터베이스 마이그레이션 0019가 아직 적용되지 않았습니다." : "불러오지 못했습니다: " + error.message,
    };
  }
  const rows = (data as any[]) ?? [];
  const changed: { code: string; name: string }[] = [];
  const remaining: { code: string; name: string }[] = [];
  const toJeju: string[] = [];
  const levelFill: Record<"고" | "중", string[]> = { 고: [], 중: [] };
  for (const e of rows) {
    if (e.is_jeju) continue;
    const d = detectJejuSchool(e.name);
    if (d.jeju) {
      toJeju.push(e.id);
      changed.push({ code: e.code, name: e.name });
      if (!e.school_level && d.level) levelFill[d.level].push(e.id);
    } else {
      remaining.push({ code: e.code, name: e.name });
    }
  }
  for (let i = 0; i < toJeju.length; i += 150) {
    const { error: uErr } = await (supabase.from("exams") as any).update({ is_jeju: true }).in("id", toJeju.slice(i, i + 150));
    if (uErr) return { ok: false, msg: "바꾸지 못했습니다: " + uErr.message };
  }
  for (const lvl of ["고", "중"] as const) {
    const ids = levelFill[lvl];
    for (let i = 0; i < ids.length; i += 150) {
      await (supabase.from("exams") as any).update({ school_level: lvl }).in("id", ids.slice(i, i + 150)).is("school_level", null);
    }
  }
  revalidatePath("/exams");
  revalidatePath("/admin/review-status");
  remaining.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { ok: true, changed, remaining };
}

/**
 * 2026-10-03 원장님 요청("미분류 파일들 폴더에 넣어 줘"): 모든 시험의 이름·코드를 읽어(lib/exams/guessFolder.ts)
 * 비어 있는 폴더 칸(학교급·연도·학년·학기·구분)만 채운다. 이미 들어 있는 값(직접 고른 분류)은 건드리지 않는다.
 * 결과로 이번에 채운 시험과, 이름만으로는 다 못 채워 여전히 칸이 빈 시험을 돌려준다(화면에서 직접 고치도록).
 */
export async function autoClassifyExams(): Promise<
  | { ok: true; changed: { code: string; name: string; label: string }[]; remaining: { code: string; name: string; missing: string }[] }
  | { ok: false; msg: string }
> {
  await requireRole("admin");
  const { fetchAllPages } = await import("@/lib/supabase/fetchAll");
  const supabase = await createClient();
  const { data, error } = await fetchAllPages((f, t) =>
    (supabase.from("exams") as any)
      .select("id, code, name, school_level, folder_year, folder_grade, folder_term, folder_kind")
      .order("id")
      .range(f, t)
  );
  if (error) return { ok: false, msg: "불러오지 못했습니다: " + error.message };
  const KEYS = ["school_level", "folder_year", "folder_grade", "folder_term", "folder_kind"] as const;
  const NAMES: Record<(typeof KEYS)[number], string> = {
    school_level: "학교급",
    folder_year: "연도",
    folder_grade: "학년",
    folder_term: "학기",
    folder_kind: "중간/기말",
  };
  const changed: { code: string; name: string; label: string }[] = [];
  const remaining: { code: string; name: string; missing: string }[] = [];
  for (const e of (data as any[]) ?? []) {
    const name = String(e.name ?? "").normalize("NFC");
    const code = String(e.code ?? "").normalize("NFC");
    const g = guessFolder(name, code);
    const patch: Record<string, unknown> = {};
    for (const k of KEYS) if (e[k] == null && g[k] != null) patch[k] = g[k];
    const after = { ...e, ...patch };
    if (Object.keys(patch).length) {
      // 동시에 다른 화면에서 고친 값은 덮지 않도록 "아직 비어 있을 때만" 조건을 건다
      let q = (supabase.from("exams") as any).update(patch).eq("id", e.id);
      for (const k of Object.keys(patch)) q = q.is(k, null);
      const { error: uErr } = await q;
      if (uErr) return { ok: false, msg: "바꾸지 못했습니다: " + uErr.message };
      changed.push({ code, name, label: folderLabel(after) });
    }
    const missing = KEYS.filter((k) => after[k] == null).map((k) => NAMES[k]);
    if (missing.length) remaining.push({ code, name, missing: missing.join(", ") });
  }
  revalidatePath("/exams");
  revalidatePath("/tutor/store");
  remaining.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { ok: true, changed, remaining };
}
