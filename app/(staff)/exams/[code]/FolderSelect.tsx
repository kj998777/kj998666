"use client";

import { useState, useTransition } from "react";
import { updateFolder, type FolderKind, type FolderValue } from "../actions";

const KIND_LABEL: Record<FolderKind, string> = { 중간: "중간고사", 기말: "기말고사", 기타: "기타" };

export default function FolderSelect({
  code,
  year,
  grade,
  term,
  kind,
}: {
  code: string;
  year: string | null;
  grade: number | null;
  term: number | null;
  kind: FolderKind | null;
}) {
  const [value, setValue] = useState<{ year: string; grade: string; term: string; kind: string }>({
    year: year ?? "",
    grade: grade != null ? String(grade) : "",
    term: term != null ? String(term) : "",
    kind: kind ?? "",
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function commit(next: typeof value) {
    setValue(next);
    setMsg("");
    const payload: FolderValue = {
      year: next.year || null,
      grade: next.grade ? Number(next.grade) : null,
      term: next.term ? Number(next.term) : null,
      kind: (next.kind || null) as FolderKind | null,
    };
    start(async () => {
      const r = await updateFolder(code, payload);
      if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">폴더</span>
      <input
        className="input py-1 text-sm"
        style={{ width: "5rem" }}
        placeholder="연도"
        value={value.year}
        disabled={pending}
        maxLength={4}
        onChange={(e) => setValue({ ...value, year: e.target.value.replace(/[^0-9]/g, "") })}
        onBlur={(e) => commit({ ...value, year: e.target.value.replace(/[^0-9]/g, "") })}
      />
      <select
        className="input py-1 text-sm"
        style={{ width: "auto" }}
        value={value.grade}
        disabled={pending}
        onChange={(e) => commit({ ...value, grade: e.target.value })}
      >
        <option value="">학년 선택 안 함</option>
        <option value="1">1학년</option>
        <option value="2">2학년</option>
        <option value="3">3학년</option>
      </select>
      <select
        className="input py-1 text-sm"
        style={{ width: "auto" }}
        value={value.term}
        disabled={pending}
        onChange={(e) => commit({ ...value, term: e.target.value })}
      >
        <option value="">학기 선택 안 함</option>
        <option value="1">1학기</option>
        <option value="2">2학기</option>
      </select>
      <select
        className="input py-1 text-sm"
        style={{ width: "auto" }}
        value={value.kind}
        disabled={pending}
        onChange={(e) => commit({ ...value, kind: e.target.value })}
      >
        <option value="">구분 선택 안 함</option>
        {(Object.keys(KIND_LABEL) as FolderKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
