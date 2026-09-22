import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeSubmission, type AnswerKeyItem } from "@/lib/grading";
import { isLevel, validGrade, cleanClassName, classKey, classLabel } from "@/lib/classLabel";

// 학생 제출을 실제로 기록하는 유일한 경로. 서비스롤 키를 쓰므로 RLS를 우회하지만,
// 그만큼 여기서 직접 모든 검증(반 존재, 시험 열림 여부, 문항 수, 채점)을 다시 한다.
// 클라이언트가 보낸 반/학년/학교급 값은 절대 그대로 믿지 않고, 서버가 classes 테이블과
// 대조해서 실제로 등록된 조합인지 확인한 뒤 class_label 문자열도 서버가 직접 만든다.
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);

  let body: { lv?: unknown; grade?: unknown; cls?: unknown; name?: unknown; answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const lv = body.lv;
  if (!isLevel(lv)) {
    return NextResponse.json({ ok: false, msg: "초·중·고, 학년, 반을 목록에서 골라 주세요." }, { status: 400 });
  }
  const grade = validGrade(lv, body.grade);
  const clsInput = cleanClassName(body.cls);
  if (!grade || !clsInput) {
    return NextResponse.json(
      { ok: false, msg: "초·중·고, 학년, 반을 목록에서 골라 주세요. (화면이 예전 것이면 새로고침해 주세요.)" },
      { status: 400 }
    );
  }

  const name = String(body.name ?? "").trim().slice(0, 20);
  if (!name) return NextResponse.json({ ok: false, msg: "이름을 입력해 주세요." }, { status: 400 });

  const answers = Array.isArray(body.answers) ? body.answers : [];

  const admin = createAdminClient();

  // 1) 반이 실제로 등록된 조합인지 확인 — 클라이언트 값은 신뢰하지 않고 DB에 있는 정확한 이름을 쓴다.
  const { data: matchedClasses } = await admin.from("classes").select("name").eq("level", lv).eq("grade", grade);
  const matched = (matchedClasses ?? []).find((c) => classKey(c.name) === classKey(clsInput));
  if (!matched) {
    return NextResponse.json(
      { ok: false, msg: "고른 반이 목록에 없습니다. 페이지를 새로고침해서 다시 골라 주세요." },
      { status: 400 }
    );
  }
  const class_label = classLabel(lv, grade, matched.name);

  // 2) 시험 존재 + 열림 상태 확인
  const { data: exam } = await admin.from("exams").select("id, status").eq("code", code).single();
  if (!exam) return NextResponse.json({ ok: false, msg: "존재하지 않는 시험입니다." }, { status: 404 });
  if (exam.status !== "열림") {
    return NextResponse.json({ ok: false, msg: "제출이 마감된 시험입니다." }, { status: 409 });
  }

  // 3) 정답 조회 + 문항 수 확인
  const { data: keyRows } = await admin
    .from("answer_key")
    .select("item_label, correct_answers, points, type")
    .eq("exam_id", exam.id)
    .order("sort_order")
    .order("item_label");

  const key = (keyRows ?? []) as AnswerKeyItem[];
  if (key.length === 0) {
    return NextResponse.json({ ok: false, msg: "시험 정답이 등록되지 않았습니다." }, { status: 409 });
  }
  if (answers.length !== key.length) {
    return NextResponse.json(
      { ok: false, msg: "문항 수가 맞지 않습니다. 페이지를 새로고침해 주세요." },
      { status: 400 }
    );
  }

  // 4) 채점 (순수 함수 — lib/grading.ts, 단위 테스트로 검증됨)
  const { perItem, totalScore } = gradeSubmission(key, answers);
  const sanitizedAnswers = perItem.map((p) => p.given);

  // 5) 원자적 기록: 시험이 그 사이 닫히지 않았는지 잠금과 함께 다시 확인 + 제출/채점 결과 동시 기록.
  //    (같은 반+이름 중복 제출은 DB의 unique 제약 위반으로 여기서 걸러진다.)
  const { data: submissionId, error } = await admin.rpc("submit_and_grade", {
    p_exam_code: code,
    p_class_label: class_label,
    p_student_name: name,
    p_answers: sanitizedAnswers,
    p_per_item: perItem,
    p_total_score: totalScore,
  });

  if (error) {
    const msg = error.message || "제출하지 못했습니다.";
    const status = msg.includes("이미 같은 이름") ? 409 : msg.includes("지금 제출을 받지") ? 409 : 400;
    return NextResponse.json({ ok: false, msg }, { status });
  }

  return NextResponse.json({ ok: true, submissionId });
}
