"use client";

import { useState, useTransition } from "react";
import { updateCollection } from "../actions";

// 0051(2026-10-05): 학교 기출이 아닌 메딕수학 자료(예: 부교재 변형문제)를 분류로 묶는 칸.
// 값을 넣으면 시험 목록·기출 스토어에서 연도 폴더 대신 맨 위 분류 폴더에 들어간다.
export default function CollectionInput({ code, value }: { code: string; value: string | null }) {
  const [text, setText] = useState(value ?? "");
  const [saved, setSaved] = useState(value ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function commit(next: string) {
    const v = next.trim();
    if (v === saved) return;
    setMsg("");
    start(async () => {
      const r = await updateCollection(code, v || null);
      if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
      else {
        setSaved(v);
        setMsg(v ? "저장됨" : "분류 해제됨");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">분류</span>
      <input
        className="input py-1 text-sm"
        style={{ width: "14rem" }}
        placeholder="예: 부교재 변형문제 (학교 기출이면 비움)"
        value={text}
        disabled={pending}
        maxLength={40}
        list="exam-collection-suggest"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
      />
      <datalist id="exam-collection-suggest">
        <option value="부교재 변형문제" />
      </datalist>
      {msg && <span className={"text-xs " + (msg.includes("못") || msg.includes("실패") ? "text-red-600" : "text-emerald-600")}>{msg}</span>}
    </div>
  );
}
