"use client";

import { useState, useTransition } from "react";
import { deleteSubmission } from "./actions";

type PerItem = { item_label: string; given: string; correct: boolean; points: number };
type Row = {
  id: string;
  class_label: string;
  student_name: string;
  submitted_at: string;
  total_score: number;
  per_item: PerItem[];
};

export default function ResultRow({ code, row, canDelete }: { code: string; row: Row; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-2">{row.class_label}</td>
        <td className="py-2 pr-2">
          <button className="hover:underline" onClick={() => setOpen((v) => !v)}>
            {row.student_name}
          </button>
        </td>
        <td className="py-2 pr-2 font-medium">{row.total_score}</td>
        <td className="py-2 pr-2 text-slate-500">{new Date(row.submitted_at).toLocaleString("ko-KR")}</td>
        <td className="py-2 pr-2 text-right">
          {canDelete && (
            <button
              className="text-slate-400 hover:text-red-600"
              disabled={pending}
              onClick={() => {
                if (!confirm(`${row.student_name} 학생의 제출을 삭제할까요? 다시 제출할 수 있게 됩니다.`)) return;
                start(async () => { await deleteSubmission(code, row.id); });
              }}
            >
              삭제(재제출 허용)
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={5} className="py-2 px-2">
            <div className="flex flex-wrap gap-1">
              {row.per_item.map((it) => (
                <span
                  key={it.item_label}
                  className={
                    "badge " + (it.correct ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")
                  }
                  title={`정답 여부: ${it.correct ? "정답" : "오답"}`}
                >
                  {it.item_label}번: {it.given || "(무응답)"}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
