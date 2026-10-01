"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMaker, loadPool, toPreview, type PreviewItem } from "@/lib/placement/server";
import { cleanUnits, isCourseKey } from "@/lib/curriculum/units";
import { PLACEMENT_MAX_N, PLACEMENT_MIN_N, pickPlacement, replaceItem, scopeLabel, scopePool, type Scope } from "@/lib/placement/pick";

// 입학테스트(0047) 서버 액션 — 학원(편집자·관리자)·과외선생님이 같이 쓴다. 누가 부르는지는 로그인 역할로 정하고,
// 고를 수 있는 문항·값·포인트 차감은 DB 함수(create_placement_test)가 다시 확인한다.

function cleanScope(s: any): Scope | null {
  const level = s?.level === "중" || s?.level === "고" ? s.level : null;
  const grade = Number(s?.grade);
  if (!level || !Number.isInteger(grade) || grade < 1 || grade > 3) return null;
  // 2026-10-01: 과목(단원표 키) + 고른 중단원(null = 전부)
  const course = isCourseKey(String(s?.course ?? "")) ? String(s.course) : "";
  return { level, grade, course, units: s?.units == null ? null : cleanUnits(s.units) };
}

export async function previewPlacement(
  scope: Scope,
  n: number,
  seed: number
): Promise<{ ok: boolean; msg?: string; items?: PreviewItem[]; poolSize?: number }> {
  const m = await currentMaker();
  if (!m) return { ok: false, msg: "편집자·관리자·과외선생님만 만들 수 있습니다." };
  const sc = cleanScope(scope);
  if (!sc) return { ok: false, msg: "학년을 골라 주세요." };
  if (sc.units && !sc.units.length) return { ok: false, msg: "출제할 단원을 하나 이상 골라 주세요." };
  const pool = scopePool(await loadPool(m), sc);
  if (pool.length < PLACEMENT_MIN_N) return { ok: false, msg: `${scopeLabel(sc)}에는 고를 수 있는 문항이 ${pool.length}개뿐이라 만들 수 없습니다.` };
  const want = Math.max(PLACEMENT_MIN_N, Math.min(PLACEMENT_MAX_N, Math.round(Number(n)) || 10));
  const items = pickPlacement(pool, want, Math.floor(Number(seed)) || 1);
  return { ok: true, items: items.map((it) => toPreview(it, m.kind)), poolSize: pool.length };
}

export async function replacePlacementItem(
  scope: Scope,
  ids: string[],
  index: number,
  seed: number,
  exclude: string[]
): Promise<{ ok: boolean; msg?: string; item?: PreviewItem }> {
  const m = await currentMaker();
  if (!m) return { ok: false, msg: "편집자·관리자·과외선생님만 만들 수 있습니다." };
  const sc = cleanScope(scope);
  if (!sc) return { ok: false, msg: "학년을 골라 주세요." };
  const pool = scopePool(await loadPool(m), sc);
  const by = new Map(pool.map((it) => [it.id, it]));
  const current = (Array.isArray(ids) ? ids : []).map((id) => by.get(String(id))).filter((x): x is NonNullable<typeof x> => !!x);
  if (current.length !== (ids ?? []).length) return { ok: false, msg: "문항 목록이 바뀌었습니다. 다시 뽑아 주세요." };
  const got = replaceItem(pool, current, Number(index), Math.floor(Number(seed)) || 1, new Set((exclude ?? []).map(String)));
  if (!got) return { ok: false, msg: "바꿀 수 있는 다른 문항이 없습니다." };
  return { ok: true, item: toPreview(got, m.kind) };
}

export async function createPlacement(
  ids: string[],
  title: string,
  scope: string
): Promise<{ ok: boolean; msg?: string; id?: string; code?: string; cost?: number }> {
  const m = await currentMaker();
  if (!m) return { ok: false, msg: "편집자·관리자·과외선생님만 만들 수 있습니다." };
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x))));
  if (clean.length < PLACEMENT_MIN_N || clean.length > PLACEMENT_MAX_N) return { ok: false, msg: `문항은 ${PLACEMENT_MIN_N}~${PLACEMENT_MAX_N}개로 만들어 주세요.` };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("create_placement_test", {
    p_item_ids: clean,
    p_title: String(title ?? "").slice(0, 60),
    p_scope: String(scope ?? "").slice(0, 40),
  });
  if (error) {
    const msg = String(error.message || "");
    if (/function .*create_placement_test|does not exist/i.test(msg)) return { ok: false, msg: "아직 준비 중인 기능입니다(0047 적용 전)." };
    return { ok: false, msg };
  }
  revalidatePath(m.kind === "staff" ? "/placement" : "/tutor/placement");
  if (m.kind === "tutor") revalidatePath("/tutor/dashboard");
  return { ok: true, id: data?.id, code: data?.code, cost: Number(data?.cost ?? 0) };
}

export async function setPlacementOpen(id: string, open: boolean): Promise<{ ok: boolean; msg?: string }> {
  const m = await currentMaker();
  if (!m) return { ok: false, msg: "권한이 없습니다." };
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { ok: false, msg: "입학테스트를 찾을 수 없습니다." };
  const supabase = await createClient();
  const { error } = await (supabase.rpc as any)("set_placement_open", { p_id: id, p_open: !!open });
  if (error) return { ok: false, msg: String(error.message || "바꾸지 못했습니다.") };
  revalidatePath(m.kind === "staff" ? `/placement/${id}` : `/tutor/placement/${id}`);
  return { ok: true };
}
