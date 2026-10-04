import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeSubmission, type AnswerKeyItem } from "@/lib/grading";
import { isLevel, validGrade, cleanClassName, classKey, classLabel } from "@/lib/classLabel";
import { tutorClassLabel, tutorIdFromToken } from "@/lib/tutor/link";
import { examCodeVariants, pickExamByCode } from "@/lib/exams/codeVariants";

// 학생 제출을 실제로 기록하는 유일한 경로. 서비스롤 키를 쓰므로 RLS를 우회하지만,
// 그만큼 여기서 직접 모든 검증(반 존재, 시험 열림 여부, 문항 수, 채점)을 다시 한다.
// 클라이언트가 보낸 반/학년/학교급 값은 절대 그대로 믿지 않고, 서버가 classes 테이블과
// 대조해서 실제로 등록된 조합인지 확인한 뒤 class_label 문자열도 서버가 직접 만든다.
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);

  let body: { lv?: unknown; grade?: unknown; cls?: unknown; name?: unknown; answers?: unknown; t?: unknown; guessed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 20);
  if (!name) return NextResponse.json({ ok: false, msg: "이름을 입력해 주세요." }, { status: 400 });

  const answers = Array.isArray(body.answers) ? body.answers : [];
  // 2026-10-01: 문항마다 "찍음" 표시(true/false 배열, 없으면 모두 false)
  const guessed = Array.isArray(body.guessed) ? body.guessed.map((g) => g === true) : [];

  // #4: 과외선생님 전용 링크(?t=토큰)로 들어온 제출 — 학원 반을 고르지 않고, 그 과외선생님이 이 시험을
  // 구매했을 때만 받는다(최종 확인은 submit_and_grade RPC가 잠금과 함께 다시 함).
  const tutorToken = typeof body.t === "string" && body.t ? body.t : null;
  let tutorId: string | null = null;
  if (tutorToken) {
    tutorId = await tutorIdFromToken(tutorToken);
    if (!tutorId) {
      return NextResponse.json({ ok: false, msg: "제출 링크가 올바르지 않습니다. 선생님께 받은 링크를 다시 확인해 주세요." }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  let class_label: string;

  if (tutorToken && tutorId) {
    class_label = tutorClassLabel(tutorToken);
  } else {
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


    // 1) 반이 실제로 등록된 조합인지 확인 — 클라이언트 값은 신뢰하지 않고 DB에 있는 정확한 이름을 쓴다.
    const { data: matchedClasses } = await admin.from("classes").select("name").eq("level", lv).eq("grade", grade);
    const matched = (matchedClasses ?? []).find((c) => classKey(c.name) === classKey(clsInput));
    if (!matched) {
      return NextResponse.json(
        { ok: false, msg: "고른 반이 목록에 없습니다. 페이지를 새로고침해서 다시 골라 주세요." },
        { status: 400 }
      );
    }
    class_label = classLabel(lv, grade, matched.name);
  }

  // 2) 시험 존재 + (열림 상태이거나 #109: 과외선생님 스토어에 판매 중) 확인
  //    실제 최종 검증은 submit_and_grade RPC가 잠금과 함께 다시 하므로, 여기서는 빠른 실패용.
  // 코드가 NFC/NFD 어느 쪽으로 와도 찾고, 아래 RPC에는 DB에 저장된 코드 그대로 넘긴다(lib/exams/codeVariants.ts)
  const { data: examRows } = await admin
    .from("exams")
    .select("id, code, status, tutor_download_cost")
    .in("code", examCodeVariants(code))
    .limit(5);
  const exam = pickExamByCode(examRows, code);
  if (!exam) return NextResponse.json({ ok: false, msg: "존재하지 않는 시험입니다." }, { status: 404 });
  if (!tutorId && exam.status !== "열림" && exam.tutor_download_cost === null) {
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
  const { perItem, totalScore } = gradeSubmission(key, answers, guessed.length === key.length ? guessed : undefined);
  const sanitizedAnswers = perItem.map((p) => p.given);

  // 5) 원자적 기록: 시험이 그 사이 닫히지 않았는지 잠금과 함께 다시 확인 + 제출/채점 결과 동시 기록.
  //    (같은 반+이름 중복 제출은 DB의 unique 제약 위반으로 여기서 걸러진다.)
  //    p_tutor_id는 과외선생님 링크일 때만 넘긴다(0017 이전 DB에서도 일반 제출이 그대로 동작하도록).
  const rpcArgs: Record<string, unknown> = {
    p_exam_code: exam.code,
    p_class_label: class_label,
    p_student_name: name,
    p_answers: sanitizedAnswers,
    p_per_item: perItem,
    p_total_score: totalScore,
  };
  if (tutorId) rpcArgs.p_tutor_id = tutorId;
  const { data: submissionId, error } = await (admin.rpc as any)("submit_and_grade", rpcArgs);

  if (error) {
    const msg = error.message || "제출하지 못했습니다.";
    const status = msg.includes("이미 같은 이름") ? 409 : msg.includes("지금 제출을 받지") || msg.includes("이 링크로는") ? 409 : 400;
    return NextResponse.json({ ok: false, msg }, { status });
  }

  return NextResponse.json({ ok: true, submissionId });
}
