import "server-only";
import { createClient } from "@/lib/supabase/server";

// #4: "구매한 시험"에 대해서만 여는 과외선생님 화면들의 공통 검사. RLS만 믿지 않고 페이지·라우트에서
// tutor_exam_purchases 소유를 한 번 더 확인한다(이 코드베이스의 방어 이중화 패턴).

export type PurchasedExam = { id: string; code: string; name: string };

export async function getPurchasedExam(tutorId: string, code: string): Promise<PurchasedExam | null> {
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, code, name").eq("code", code).maybeSingle()) as any;
  if (!exam) return null;
  const { data: purchase } = (await supabase
    .from("tutor_exam_purchases")
    .select("id")
    .eq("exam_id", exam.id)
    .eq("tutor_id", tutorId)
    .maybeSingle()) as any;
  return purchase ? (exam as PurchasedExam) : null;
}
