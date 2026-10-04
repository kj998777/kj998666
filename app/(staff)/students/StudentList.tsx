"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sparkSvg } from "@/lib/students/analysis";

export type ListRow = {
  id: string;
  name: string;
  classText: string;
  classLabel: string;
  tutor: boolean;
  nExams: number;
  avgRate: number | null;
  lastRate: number | null;
  rates: number[];
  lastAt: string;
  hidden: boolean;
  merged: boolean;
  hasMemo: boolean;
};

type Level = "all" | "초" | "중" | "고" | "과외";
type Sort = "recent" | "name" | "low" | "drop";

const PREF_KEY = "mc-students-filter";

function pct(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function levelOf(r: ListRow): Level {
  if (r.tutor) return "과외";
  const m = /^(초|중|고)/.exec(r.classLabel);
  return (m?.[1] as Level) ?? "all";
}
function gradeOf(r: ListRow): string {
  const m = /^(초|중|고)(\d)/.exec(r.classLabel);
  return m ? m[1] + m[2] : "";
}
/** 최근 두 시험 차이(추이 내림 정렬용) */
function lastDrop(r: ListRow): number {
  const n = r.rates.length;
  return n >= 2 ? r.rates[n - 1] - r.rates[n - 2] : 0;
}

export default function StudentList({ rows }: { rows: ListRow[] }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<Level>("all");
  const [grade, setGrade] = useState("");
  const [cls, setCls] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [showHidden, setShowHidden] = useState(false);

  // 고른 필터는 이 기기에 기억(다음에 들어와도 같은 반으로)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (v.level) setLevel(v.level);
      if (typeof v.grade === "string") setGrade(v.grade);
      if (typeof v.cls === "string") setCls(v.cls);
      if (v.sort) setSort(v.sort);
    } catch {
      /* 무시 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ level, grade, cls, sort }));
    } catch {
      /* 무시 */
    }
  }, [level, grade, cls, sort]);

  const grades = useMemo(
    () => Array.from(new Set(rows.filter((r) => level === "all" || levelOf(r) === level).map(gradeOf).filter(Boolean))).sort(),
    [rows, level]
  );
  const classes = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => !r.tutor && (level === "all" || levelOf(r) === level) && (!grade || gradeOf(r) === grade))
            .map((r) => r.classLabel)
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [rows, level, grade]
  );

  const shown = useMemo(() => {
    const t = q.replace(/\s+/g, "");
    let list = rows.filter(
      (r) =>
        (showHidden || !r.hidden) &&
        (level === "all" || levelOf(r) === level) &&
        (!grade || gradeOf(r) === grade) &&
        (!cls || r.classLabel === cls) &&
        (!t || r.name.replace(/\s+/g, "").includes(t) || r.classText.replace(/\s+/g, "").includes(t))
    );
    list = [...list];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    else if (sort === "low") list.sort((a, b) => (a.avgRate ?? 2) - (b.avgRate ?? 2));
    else if (sort === "drop") list.sort((a, b) => lastDrop(a) - lastDrop(b));
    else list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return list;
  }, [rows, q, level, grade, cls, sort, showHidden]);

  const chip = (on: boolean) =>
    "rounded-full border px-3 py-1 text-sm " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700");

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[12rem]" placeholder="이름·반으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
            <option value="recent">최근 시험 본 순</option>
            <option value="name">이름순</option>
            <option value="low">평균 낮은 순</option>
            <option value="drop">최근에 많이 떨어진 순</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "고", "중", "과외"] as Level[]).map((l) => ( /* 2026-10-03: 초등 탭 뺌 */
            <button
              key={l}
              type="button"
              className={chip(level === l)}
              onClick={() => {
                setLevel(l);
                setGrade("");
                setCls("");
              }}
            >
              {l === "all" ? "전체" : l === "과외" ? "과외 반" : l === "고" ? "고등" : l === "중" ? "중등" : l}
            </button>
          ))}
        </div>
        {level !== "과외" && (grades.length > 1 || classes.length > 1) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {grades.length > 1 && (
              <select
                className="input w-auto"
                value={grade}
                onChange={(e) => {
                  setGrade(e.target.value);
                  setCls("");
                }}
                aria-label="학년"
              >
                <option value="">모든 학년</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            {classes.length > 1 && (
              <select className="input w-auto" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="반">
                <option value="">모든 반</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          숨긴 학생도 보기
        </label>
      </div>

      <div className="card">
        {shown.length === 0 ? (
          <p className="text-sm text-slate-500">{rows.length === 0 ? "아직 학생 제출이 없습니다." : "조건에 맞는 학생이 없습니다."}</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">이름</th>
                  <th className="py-2 pr-2">반</th>
                  <th className="py-2 pr-2 text-right">시험</th>
                  <th className="py-2 pr-2 text-right">평균</th>
                  <th className="py-2 pr-2 text-right">최근</th>
                  <th className="py-2 pr-2">추이</th>
                  <th className="py-2 pr-2">최근 시험일</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const d = lastDrop(r);
                  return (
                    <tr key={r.id} className={"border-b border-slate-100 " + (r.hidden ? "opacity-50" : "")}>
                      <td className="py-2 pr-2">
                        <Link href={`/students/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        {r.merged && <span className="ml-1 badge bg-slate-100 text-slate-600">합침</span>}
                        {r.hasMemo && <span className="ml-1 badge bg-sky-50 text-sky-700">메모</span>}
                        {r.hidden && <span className="ml-1 badge bg-slate-100 text-slate-500">숨김</span>}
                      </td>
                      <td className="py-2 pr-2 text-slate-600">{r.classText}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{r.nExams}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{pct(r.avgRate)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {pct(r.lastRate)}
                        {r.rates.length >= 2 && Math.abs(d) >= 0.05 && (
                          <span className={"ml-1 text-xs " + (d > 0 ? "text-emerald-600" : "text-red-600")}>
                            {d > 0 ? "▲" : "▼"}
                            {Math.round(Math.abs(d) * 100)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2" dangerouslySetInnerHTML={{ __html: sparkSvg(r.rates) }} />
                      <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">{new Date(r.lastAt).toLocaleDateString("ko-KR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
