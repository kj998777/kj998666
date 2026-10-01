import "server-only";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachDigitized, loadBankDetails, loadBankItems, type BankDetail } from "@/lib/bank/load";
import { loadTutorBank } from "@/lib/bank/tutorLoad";
import type { BankItem } from "@/lib/bank/search";
import { diagnose, usable, type Diagnosis } from "@/lib/placement/pick";
import type { PerItemResult } from "@/lib/grading";

// 입학테스트(0047) 서버 쪽 읽기. 학원(편집자·관리자)은 정답 확정된 모든 문항, 과외선생님은 기출 스토어 시험의 문항만 고를 수 있다.

export type Maker = { kind: "staff" | "tutor"; userId: string };

export async function currentMaker(): Promise<Maker | null> {
  const s = await getSessionAndRole();
  if (!s) return null;
  if (s.role === "admin" || s.role === "editor") return { kind: "staff", userId: s.userId };
  if (s.role === "tutor") return { kind: "tutor", userId: s.userId };
  return null;
}

/** 고를 수 있는 문항 전체(정답 포함 — 서버 안에서만 쓰고 화면에는 toPreview로 보낸다) */
export async function loadPool(m: Maker): Promise<BankItem[]> {
  const items =
    m.kind === "staff" ? await loadBankItems(await createClient()) : (await loadTutorBank(createAdminClient(), m.userId)).items;
  return items.filter(usable);
}

/** 미리 보기 화면에 보내는 문항 — 과외선생님에게는 정답을 보내지 않는다(만든 뒤 정답·해설지로 받음) */
export type PreviewItem = {
  id: string;
  examName: string;
  label: string;
  unit: string;
  area: string;
  difficulty: string;
  type: string;
  statement: string;
  hasLocation: boolean;
  answer?: string;
};

export function toPreview(it: BankItem, kind: Maker["kind"]): PreviewItem {
  return {
    id: it.id,
    examName: it.examName,
    label: it.label,
    unit: it.unit,
    area: it.area,
    difficulty: it.difficulty,
    type: it.type,
    statement: it.statement.slice(0, 400),
    hasLocation: it.hasLocation,
    ...(kind === "staff" ? { answer: it.answerDisplay || it.correctAnswers } : {}),
  };
}

export type PlacementTest = {
  id: string;
  code: string;
  owner_id: string;
  owner_kind: "staff" | "tutor";
  title: string;
  scope_label: string;
  item_ids: string[];
  points: number[];
  points_spent: number;
  is_open: boolean;
  created_at: string;
};

/** 볼 수 있는 테스트(RLS: 만든 사람·관리자, 학원 테스트는 직원 모두) */
export async function loadVisibleTest(id: string): Promise<PlacementTest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = (await (supabase.from("placement_tests") as any).select("*").eq("id", id).maybeSingle()) as any;
  return (data as PlacementTest) ?? null;
}

/** 테스트 문항 자세히(정답·풀이·자리). 그림을 오릴 PDF는 그 문항 쪽 하나만 주므로 쪽 번호는 1로 바꾼다. */
export async function loadTestDetails(test: PlacementTest): Promise<BankDetail[]> {
  const admin = createAdminClient();
  const items = align(test, await attachDigitized(admin, await loadBankDetails(admin, test.item_ids ?? [])));
  return items.map((it) => ({ ...it, sourcePage: it.sourcePage ? 1 : null }));
}

/** 테스트에 넣은 순서·배점 그대로(문항이 지워졌으면 빈 자리 — 번호·배점·제출 답과 어긋나지 않게) */
function align(test: PlacementTest, details: BankDetail[]): BankDetail[] {
  const by = new Map(details.map((d) => [d.id, d]));
  return (test.item_ids ?? []).map((id, i) => {
    const d = by.get(id);
    const points = Number(test.points?.[i] ?? 0);
    if (d) return { ...d, points };
    return {
      id, examId: "", examCode: "", examName: "(지워진 문항)", examStatus: "", schoolLevel: null, grade: null, year: null, isJeju: false,
      label: "", sortOrder: i, area: "", unit: "", difficulty: "중", type: "", statement: "", answerDisplay: "", correctAnswers: "",
      points, confirmed: false, hasLocation: false, solution: "", sourcePage: null, bbox: null,
    };
  });
}

export type PlacementSubmissionRow = {
  id: string;
  student_name: string;
  total_score: number;
  per_item: PerItemResult[];
  created_at: string;
  diag: Diagnosis;
};

export async function loadSubmissions(test: PlacementTest, details: BankDetail[]): Promise<PlacementSubmissionRow[]> {
  const supabase = await createClient();
  const { data } = (await (supabase.from("placement_submissions") as any)
    .select("id, student_name, total_score, per_item, created_at")
    .eq("test_id", test.id)
    .order("created_at", { ascending: false })
    .limit(300)) as any;
  return ((data as any[]) ?? []).map((s) => ({ ...s, total_score: Number(s.total_score), diag: diagnoseRow(details, s.per_item) }));
}

export function diagnoseRow(details: BankDetail[], perItem: PerItemResult[] | null | undefined): Diagnosis {
  const p = Array.isArray(perItem) ? perItem : [];
  return diagnose(
    details.map((d, i) => ({
      label: String(i + 1),
      unit: d.unit,
      area: d.area,
      difficulty: d.difficulty,
      points: d.points,
      correct: !!p[i]?.correct,
      guessed: !!p[i]?.guessed,
    }))
  );
}

/** 학생 제출 화면(/p/코드)·채점용: 코드로 테스트를 찾는다(로그인 없음 — 서비스롤, 정답은 화면으로 보내지 않는다) */
export async function loadTestByCode(code: string): Promise<{ test: PlacementTest; details: BankDetail[] } | null> {
  if (!/^P[A-Z0-9]{6}$/.test(code)) return null;
  const admin = createAdminClient() as any;
  const { data: test } = await admin.from("placement_tests").select("*").eq("code", code).maybeSingle();
  if (!test) return null;
  const details = align(test as PlacementTest, await loadBankDetails(admin, (test as PlacementTest).item_ids ?? []));
  return { test: test as PlacementTest, details };
}
