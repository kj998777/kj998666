import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeSubmission, type AnswerKeyItem } from "@/lib/grading";
import { loadTestByCode } from "@/lib/placement/server";

// 입학테스트 학생 제출(0047) — /p/<코드> 화면에서 부른다. 로그인 없이 받으므로 서비스롤로 기록하고,
// 테스트가 열려 있는지·문항 수·채점·이름 중복을 여기서 모두 다시 확인한다(학생이 보낸 점수는 받지 않는다).
export const dynamic = "force-dynamic";

const MAX_SUBMISSIONS = 300;

export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).toUpperCase();
  let body: { name?: unknown; answers?: unknown; guessed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (!name) return NextResponse.json({ ok: false, msg: "이름을 입력해 주세요." }, { status: 400 });
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => String(a ?? "").slice(0, 200)) : [];
  const guessed = Array.isArray(body.guessed) ? body.guessed.map((g) => g === true) : [];

  const found = await loadTestByCode(code);
  if (!found) return NextResponse.json({ ok: false, msg: "입학테스트를 찾을 수 없습니다. 받은 링크를 다시 확인해 주세요." }, { status: 404 });
  const { test, details } = found;
  if (!test.is_open) return NextResponse.json({ ok: false, msg: "이 입학테스트는 지금 제출을 받지 않습니다." }, { status: 409 });

  const key: AnswerKeyItem[] = details.map((d, i) => ({
    item_label: String(i + 1),
    correct_answers: d.correctAnswers,
    points: Number(test.points?.[i] ?? 0),
    type: d.type === "객관식" ? "객관식" : "주관식",
  }));
  if (answers.length !== key.length) {
    return NextResponse.json({ ok: false, msg: "문항 수가 맞지 않습니다. 화면을 새로고침한 뒤 다시 제출해 주세요." }, { status: 400 });
  }
  const { perItem, totalScore } = gradeSubmission(key, answers, guessed.length === key.length ? guessed : undefined);

  const admin = createAdminClient() as any;
  const { count } = await admin.from("placement_submissions").select("id", { count: "exact", head: true }).eq("test_id", test.id);
  if ((count ?? 0) >= MAX_SUBMISSIONS) {
    return NextResponse.json({ ok: false, msg: "이 입학테스트는 제출이 너무 많아 더 받을 수 없습니다. 선생님께 문의해 주세요." }, { status: 409 });
  }
  const { error } = await admin.from("placement_submissions").insert({
    test_id: test.id,
    student_name: name,
    answers: perItem.map((p) => p.given),
    per_item: perItem,
    total_score: totalScore,
  });
  if (error) {
    if (String(error.code) === "23505") {
      return NextResponse.json({ ok: false, msg: "이미 같은 이름으로 제출했습니다. 동명이인이면 이름 뒤에 A·B처럼 붙여 주세요." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, msg: "제출하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
