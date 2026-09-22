"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteExam } from "../actions";

export default function DeleteExamButton({ examId }: { examId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      className="btn-danger"
      disabled={pending}
      onClick={() => {
        if (!confirm("이 시험과 정답·제출·채점 결과를 모두 삭제할까요? 되돌릴 수 없습니다.")) return;
        start(async () => {
          const r = await deleteExam(examId);
          if (r.ok) router.push("/exams");
          else alert(r.msg ?? "삭제하지 못했습니다.");
        });
      }}
    >
      시험 삭제
    </button>
  );
}
