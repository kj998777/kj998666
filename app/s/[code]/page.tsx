import { createAdminClient } from "@/lib/supabase/admin";
import StudentSubmitForm from "./StudentSubmitForm";

// 공개(로그인 불필요) 학생 제출 화면.
// 서비스롤 키로 직접 조회하는 이유: RLS는 "열림" 상태만 익명에게 보여주므로, 그 외의 경우에도
// (존재하지 않음/닫힘) 학생에게 정확한 안내 문구를 보여주려면 상태를 먼저 알아야 하기 때문.
// 이 서비스롤 접근은 이 서버 컴포넌트 안에서만 쓰이고, 클라이언트로는 정답이 전혀 내려가지 않는다
// (answer_key 조회 시 item_label/type/sort_order만 select, correct_answers는 절대 select하지 않음).
export default async function StudentSubmitPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);
  const admin = createAdminClient();

  const { data: exam } = await admin.from("exams").select("id, code, name, status").eq("code", code).single();

  if (!exam) {
    return <Wrap>존재하지 않는 시험입니다. 선생님께 받은 링크를 다시 확인해 주세요.</Wrap>;
  }

  const { data: classes } = await admin.from("classes").select("level, grade, name").order("level").order("grade").order("name");

  if (exam.status !== "열림") {
    return (
      <Wrap>
        <strong>{exam.name}</strong> 시험은 지금 제출을 받지 않습니다.
        <div className="text-slate-500 text-sm mt-1">선생님이 열어야 제출할 수 있어요.</div>
      </Wrap>
    );
  }

  if (!classes || classes.length === 0) {
    return <Wrap>등록된 반이 없어 제출할 수 없습니다. 선생님께 문의해 주세요.</Wrap>;
  }

  // 정답(correct_answers)은 절대 포함하지 않음
  const { data: items } = await admin
    .from("answer_key")
    .select("item_label, type, sort_order")
    .eq("exam_id", exam.id)
    .order("sort_order")
    .order("item_label");

  if (!items || items.length === 0) {
    return <Wrap>이 시험은 아직 정답이 등록되지 않아 제출할 수 없습니다. 선생님께 문의해 주세요.</Wrap>;
  }

  return (
    <StudentSubmitForm
      code={exam.code}
      examName={exam.name}
      classes={classes}
      items={items.map((it) => ({ item_label: it.item_label, type: it.type }))}
    />
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-sm text-center text-sm">{children}</div>
    </div>
  );
}
