"use client";

import { useState, useTransition } from "react";
import { updateAnswerKeyRow, deleteAnswerKeyRow } from "./actions";
import type { AnswerType } from "@/lib/supabase/types";

type Row = {
  id: string;
  item_label: string;
  correct_answers: string;
  points: number;
  type: AnswerType;
  sort_order: number;
};

export default function AnswerKeyRow({ code, row, canEdit }: { code: string; row: Row; canEdit: boolean }) {
  const [item_label, setLabel] = useState(row.item_label);
  const [correct_answers, setAnswers] = useState(row.correct_answers);
  const [points, setPoints] = useState(String(row.points));
  const [type, setType] = useState<AnswerType>(row.type);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const dirty =
    item_label !== row.item_label || correct_answers !== row.correct_answers || points !== String(row.points) || type !== row.type;

  if (!canEdit) {
    return (
      <tr className="border-b border-slate-100">
        <td className="py-1 pr-2">{row.item_label}</td>
        <td className="py-1 pr-2">{row.type}</td>
        <td className="py-1 pr-2">{row.correct_answers}</td>
        <td className="py-1 pr-2">{row.points}</td>
        <td></td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-1 pr-2">
        <input className="input py-1 w-16" value={item_label} onChange={(e) => setLabel(e.target.value)} />
      </td>
      <td className="py-1 pr-2">
        <select className="input py-1" value={type} onChange={(e) => setType(e.target.value as AnswerType)}>
          <option value="객관식">객관식</option>
          <option value="주관식">주관식</option>
        </select>
      </td>
      <td className="py-1 pr-2">
        <input className="input py-1" value={correct_answers} onChange={(e) => setAnswers(e.target.value)} />
      </td>
      <td className="py-1 pr-2">
        <input
          className="input py-1 w-20"
          type="number"
          step="0.1"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </td>
      <td className="py-1 pr-2 whitespace-nowrap">
        {dirty && (
          <button
            className="btn-secondary py-1 px-2 mr-1"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErr("");
                const r = await updateAnswerKeyRow(code, row.id, {
                  item_label,
                  correct_answers,
                  points: Number(points),
                  type,
                  sort_order: row.sort_order,
                });
                if (!r.ok) setErr(r.msg ?? "실패");
              })
            }
          >
            저장
          </button>
        )}
        <button
          className="text-slate-400 hover:text-red-600"
          disabled={pending}
          onClick={() => {
            if (!confirm(`${row.item_label}번 문항을 삭제할까요?`)) return;
            start(async () => { await deleteAnswerKeyRow(code, row.id); });
          }}
        >
          삭제
        </button>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </td>
    </tr>
  );
}
