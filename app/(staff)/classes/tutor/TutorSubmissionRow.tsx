"use client";

import { useState, useTransition } from "react";
import { deleteSubmission } from "../../exams/[code]/results/actions";
import { actionErrorMessage } from "@/lib/actionError";

type Row = { id: string; tutor: string; student_name: string; total_score: number; real_score?: number; submitted_at: string };

export default function TutorSubmissionRow({ code, row, canDelete }: { code: string; row: Row; canDelete: boolean }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-2 text-slate-600">{row.tutor}</td>
      <td className="py-2 pr-2">{row.student_name}</td>
      <td className="py-2 pr-2 font-medium">{row.total_score}</td>
      <td className={"py-2 pr-2 font-medium " + (row.real_score != null && row.real_score !== row.total_score ? "text-amber-700" : "")}>
        {row.real_score ?? row.total_score}
      </td>
      <td className="py-2 pr-2 text-slate-500">{new Date(row.submitted_at).toLocaleString("ko-KR")}</td>
      <td className="py-2 pr-2 text-right whitespace-nowrap">
        {canDelete &&
          (confirming ? (
            <span className="inline-flex items-center gap-2">
              <button
                className="text-red-600 hover:underline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setErr("");
                    try {
                      const r = await deleteSubmission(code, row.id);
                      if (!r.ok) setErr(r.msg ?? "삭제하지 못했습니다.");
                    } catch (e) {
                      setErr(actionErrorMessage(e).text);
                    }
                    setConfirming(false);
                  })
                }
              >
                {pending ? "삭제 중…" : "정말 삭제"}
              </button>
              <button className="text-slate-400 hover:underline" disabled={pending} onClick={() => setConfirming(false)}>
                취소
              </button>
            </span>
          ) : (
            <button className="text-slate-400 hover:text-red-600" onClick={() => setConfirming(true)}>
              삭제(재제출 허용)
            </button>
          ))}
        {err && <p className="text-xs text-red-600 whitespace-normal">{err}</p>}
      </td>
    </tr>
  );
}
