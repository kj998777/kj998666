import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { loadBankItems } from "@/lib/bank/load";
import type { BankItem } from "@/lib/bank/search";

// 과외선생님 맞춤 시험지(2026-09-30)용 문항 목록. 과외선생님 세션은 문항 표를 직접 못 읽으므로(블라인드 검토 보호)
// 서비스롤로 읽고, 기출 스토어에 있는 시험(검수대기 아님 + 다운로드 가격 있음)의 문항만, 정답·풀이는 빼고 돌려준다.
// 실제로 만들 수 있는지·값은 DB 함수(tutor_create_worksheet, 0042)가 다시 확인한다.

type Client = any;

/** 화면에 보내는 문항(정답·해설 없음) */
export type TutorBankItem = Omit<BankItem, "answerDisplay" | "correctAnswers">;

export type TutorBank = {
  items: BankItem[]; // 서버에서 찾기(search/facets)에 쓰는 전체 — 화면에는 strip()한 것만 보낸다
  price: Record<string, number>; // 시험 id → 그 시험 문항 값의 상한(다운로드 가격), 이미 산 시험은 0
};

// 2026-10-01 느린 화면 줄이기: 문항 전체 목록은 선생님마다 같으므로 60초 동안 서버에 받아 두고 같이 쓴다
// (맞춤 시험지·입학테스트 화면을 열 때마다 문항·정답표 수천 줄을 다시 읽지 않게). 값·구매 여부는 매번 새로 읽는다.
const cachedBankItems = unstable_cache(async () => loadBankItems(createAdminClient()), ["tutor-bank-items-v1"], { revalidate: 60 });

export async function loadTutorBank(admin: Client, tutorId: string): Promise<TutorBank> {
  const [all, examsRes, buys] = await Promise.all([
    cachedBankItems().catch(() => loadBankItems(admin)),
    fetchAllPages((a, b) => admin.from("exams").select("id, status, tutor_download_cost").neq("status", "검수대기").order("id").range(a, b)),
    fetchAllPages((a, b) => admin.from("tutor_exam_purchases").select("exam_id").eq("tutor_id", tutorId).order("exam_id").range(a, b)),
  ]);
  const owned = new Set(((buys.data as any[]) ?? []).map((p) => p.exam_id));
  const price: Record<string, number> = {};
  for (const e of (examsRes.data as any[]) ?? []) {
    if (e.tutor_download_cost == null) continue;
    price[e.id] = owned.has(e.id) ? 0 : Number(e.tutor_download_cost) || 0;
  }
  return { items: all.filter((it) => it.examId in price), price };
}

export function strip(it: BankItem): TutorBankItem {
  const { answerDisplay: _a, correctAnswers: _c, ...rest } = it;
  return { ...rest, statement: rest.statement.slice(0, 400) };
}

export { worksheetCost } from "@/lib/bank/cost";
