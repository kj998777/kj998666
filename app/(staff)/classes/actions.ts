"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { cleanClassName, classKey, isLevel, validGrade, GRADE_COUNT, type Level } from "@/lib/classLabel";

/**
 * 반 일괄 추가.
 * - grade === "all" 이면 그 학교급의 모든 학년에 같은 반 이름들을 등록한다.
 * - 이름은 줄바꿈이나 쉼표로 여러 개 입력 가능. 정리 후 중복(대소문자·공백 무시)은 걸러낸다.
 * - RLS(editor/admin만 insert 가능)가 실제 쓰기 권한을 강제하고, 여기 requireRole은 이중 방어.
 */
export async function addClasses(formData: FormData) {
  await requireRole("editor");

  const level = String(formData.get("level") ?? "");
  const gradeRaw = String(formData.get("grade") ?? "");
  const namesRaw = String(formData.get("names") ?? "");

  if (!isLevel(level)) return { ok: false, msg: "학교급을 골라 주세요." };

  const grades: number[] =
    gradeRaw === "all"
      ? Array.from({ length: GRADE_COUNT[level] }, (_, i) => i + 1)
      : [validGrade(level, gradeRaw)];

  if (grades.some((g) => g === 0)) return { ok: false, msg: "학년이 올바르지 않습니다." };

  const seen = new Set<string>();
  const names = namesRaw
    .split(/[\n,]/)
    .map((n) => cleanClassName(n))
    .filter((n) => {
      if (!n) return false;
      const k = classKey(n);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (names.length === 0) return { ok: false, msg: "등록할 반 이름을 입력해 주세요." };

  const supabase = await createClient();

  // 이미 있는 반과 겹치는지 확인(대소문자·공백 무시) 후, 새로 추가할 조합만 골라낸다.
  const { data: existing } = await supabase
    .from("classes")
    .select("level, grade, name")
    .eq("level", level)
    .in("grade", grades);

  const existingKeys = new Set((existing ?? []).map((c: any) => `${c.level}|${c.grade}|${classKey(c.name)}`));

  const rows = grades.flatMap((grade) =>
    names
      .filter((name) => !existingKeys.has(`${level}|${grade}|${classKey(name)}`))
      .map((name) => ({ level: level as Level, grade, name }))
  );

  if (rows.length === 0) {
    return { ok: false, msg: "입력한 반이 전부 이미 등록되어 있습니다." };
  }

  const { error } = await supabase.from("classes").insert(rows as any);
  if (error) {
    const msg = error.message.includes("최대 300개")
      ? "반은 최대 300개까지 등록할 수 있습니다. 안 쓰는 반을 먼저 정리해 주세요."
      : "등록하지 못했습니다: " + error.message;
    return { ok: false, msg };
  }

  revalidatePath("/classes");
  return { ok: true, msg: `${rows.length}개 반을 등록했습니다.` };
}

export async function removeClass(id: string) {
  await requireRole("editor");
  const supabase = await createClient();
  const { error } = await supabase.from("classes").delete().eq("id", id);
  if (error) return { ok: false, msg: "삭제하지 못했습니다: " + error.message };
  revalidatePath("/classes");
  return { ok: true };
}
