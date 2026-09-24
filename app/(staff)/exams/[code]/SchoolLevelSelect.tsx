"use client";

import { useState, useTransition } from "react";
import { updateSchoolLevel } from "../actions";
import type { SchoolLevel } from "@/lib/supabase/types";

const LABEL: Record<SchoolLevel, string> = { 초: "초등학교", 중: "중학교", 고: "고등학교" };

export default function SchoolLevelSelect({ code, level }: { code: string; level: SchoolLevel | null }) {
  const [value, setValue] = useState<SchoolLevel | "">(level ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="flex items-center gap-2">
      <select
        className="input py-1 text-sm w-auto"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as SchoolLevel | "";
          setValue(next);
          setMsg("");
          start(async () => {
            const r = await updateSchoolLevel(code, next || null);
            if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
          });
        }}
      >
        <option value="">학교급 선택 안 함</option>
        {(Object.keys(LABEL) as SchoolLevel[]).map((k) => (
          <option key={k} value={k}>
            {LABEL[k]}
          </option>
        ))}
      </select>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
