"use client";

import { useRef, useState, useTransition } from "react";
import { addAnswerKeyRow } from "./actions";

export default function AddAnswerKeyForm({ code, nextSortOrder }: { code: string; nextSortOrder: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
      action={(formData) => {
        setMsg("");
        start(async () => {
          const r = await addAnswerKeyRow(code, formData);
          if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
          else formRef.current?.reset();
        });
      }}
    >
      <input type="hidden" name="sort_order" value={nextSortOrder} />
      <div>
        <label className="label">번호</label>
        <input name="item_label" className="input py-1 w-20" placeholder="1" required />
      </div>
      <div>
        <label className="label">유형</label>
        <select name="type" className="input py-1" defaultValue="객관식">
          <option value="객관식">객관식</option>
          <option value="주관식">주관식</option>
        </select>
      </div>
      <div>
        <label className="label">정답 (여러 개는 |)</label>
        <input name="correct_answers" className="input py-1 w-40" placeholder="3 또는 3|삼" required />
      </div>
      <div>
        <label className="label">배점</label>
        <input name="points" type="number" step="0.1" className="input py-1 w-20" placeholder="4" required />
      </div>
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "추가하는 중…" : "문항 추가"}
      </button>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </form>
  );
}
