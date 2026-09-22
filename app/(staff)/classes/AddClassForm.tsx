"use client";

import { useState, useTransition } from "react";
import { addClasses } from "./actions";

const GRADE_COUNT: Record<string, number> = { 초: 6, 중: 3, 고: 3 };

export default function AddClassForm() {
  const [level, setLevel] = useState("고");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setMsg(null);
        start(async () => {
          const r = await addClasses(formData);
          setMsg({ ok: r.ok, text: r.msg ?? "" });
        });
      }}
    >
      <div>
        <label className="label">학교급</label>
        <select name="level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="초">초등학교</option>
          <option value="중">중학교</option>
          <option value="고">고등학교</option>
        </select>
      </div>
      <div>
        <label className="label">학년</label>
        <select name="grade" className="input" defaultValue="all">
          <option value="all">모든 학년</option>
          {Array.from({ length: GRADE_COUNT[level] }, (_, i) => i + 1).map((g) => (
            <option key={g} value={g}>
              {g}학년
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">반 이름 (줄바꿈 또는 쉼표로 여러 개)</label>
        <textarea
          name="names"
          className="input"
          rows={3}
          placeholder={"2반\n심화A\n3"}
          required
        />
                <p className="text-xs text-slate-400 mt-1">숫자만 쓰면 자동으로 &quot;반&quot;이 붙습니다 (예: 2 → 2반). 최대 20자.</p>
      </div>
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "등록하는 중…" : "등록"}
      </button>
    </form>
  );
}
