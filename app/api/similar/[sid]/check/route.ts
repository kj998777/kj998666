import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCorrect } from "@/lib/grading";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { allowedItem, loadSimilarPage } from "@/lib/similar/load";

// 오답 유사문제 답 확인 — 학생이 적은 답을 채점하고(제출 채점과 같은 lib/grading.ts), 그 문항의 정답·풀이를 돌려준다.
// answer가 비어 있으면("해설 보기") 채점 없이 정답·풀이만. 그 제출 화면에 나온 유사문제만 받는다.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { sid: string } }) {
  let body: { itemId?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const itemId = String(body.itemId ?? "");
  const answer = String(body.answer ?? "").slice(0, 200);

  const admin = createAdminClient();
  const page = await loadSimilarPage(admin, params.sid);
  const allowed = page ? allowedItem(page, itemId) : null;
  if (!allowed || allowed.kind !== "similar") {
    return NextResponse.json({ ok: false, msg: "볼 수 없는 문항입니다." }, { status: 404 });
  }

  const { data: ie } = await admin
    .from("item_explanations")
    .select("exam_id, item_label, answer_display, solution")
    .eq("id", itemId)
    .maybeSingle();
  if (!ie) return NextResponse.json({ ok: false, msg: "문항을 찾지 못했습니다." }, { status: 404 });
  const { data: key } = await admin
    .from("answer_key")
    .select("correct_answers, type")
    .eq("exam_id", ie.exam_id)
    .eq("item_label", ie.item_label)
    .maybeSingle();
  if (!key) return NextResponse.json({ ok: false, msg: "정답이 등록되지 않은 문항입니다." }, { status: 404 });

  const checked = answer.trim() !== "";
  const correct = checked ? isCorrect(answer, key.correct_answers, key.type) : null;
  // 해설의 정답 표시가 정답표와 다르면 채점 기준인 정답표를 보여 준다(보고서와 같은 규칙)
  const { text } = reconcileKeyDisplay(key.type, key.correct_answers, ie.answer_display);
  return NextResponse.json({ ok: true, checked, correct, answerDisplay: text || "", solution: String(ie.solution ?? "") });
}
