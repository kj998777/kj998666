"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ROMAN, type Level, type TreeCourse, type TreeGrade } from "@/lib/curriculum/units";

// 2026-10-01 원장님 요청: 입학테스트·문항 은행(학원·과외선생님)에서 범위를 "학교급 → 학년 → 과목 → 출제할 단원(대단원 안에 중단원)"
// 체크로 고른다. 나무(학년별 과목·대단원·중단원과 문항 수)는 서버가 lib/curriculum/units.ts buildTree로 만들어 넘긴다.
// units = 고른 중단원 id 목록(null = 보이는 단원 전부). allowAll이면 학교급·학년·과목을 "전체"로 둘 수 있다(문항 은행 찾기).

export type ScopeValue = { level: Level | ""; grade: number | null; course: string; units: string[] | null };

const chip = (on: boolean) =>
  "rounded-full border px-3 py-1 text-sm whitespace-nowrap " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-slate-500");
const sub = (on: boolean) => (on ? "text-slate-300" : "text-slate-400");

/** 학년을 고르면: 과목이 하나뿐이고 기타 문항이 없으면 그 과목을 바로 고른다 */
function autoCourse(g: TreeGrade | undefined): string {
  return g && g.courses.length === 1 && !g.etc.n ? g.courses[0].key : "";
}

export function firstScope(tree: TreeGrade[]): ScopeValue {
  const g = tree[0];
  return g ? { level: g.level, grade: g.grade, course: autoCourse(g), units: null } : { level: "", grade: null, course: "", units: null };
}

function Tri({ checked, some, disabled, onChange, label }: { checked: boolean; some: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !checked;
  }, [some, checked]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="h-4 w-4 shrink-0" />;
}

export default function ScopePicker({
  tree,
  value,
  onChange,
  allowAll = false,
}: {
  tree: TreeGrade[];
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  allowAll?: boolean;
}) {
  const levels = useMemo(() => (["중", "고"] as Level[]).filter((l) => tree.some((g) => g.level === l)), [tree]);
  const grades = tree.filter((g) => g.level === value.level);
  const g = tree.find((x) => x.level === value.level && x.grade === value.grade);
  const courses: TreeCourse[] = g ? (value.course ? g.courses.filter((c) => c.key === value.course) : g.courses) : [];
  const showEtc = !!g && !value.course && g.etc.n > 0;
  // 지금 보이는(고를 수 있는) 단원 id — 문항이 0개인 단원은 고를 수 없다
  const avail = useMemo(() => {
    const ids: string[] = [];
    for (const c of courses) for (const b of c.bigs) for (const m of b.mids) if (m.n) ids.push(m.id);
    if (showEtc && g) ids.push(g.etc.id);
    return ids;
  }, [courses, showEtc, g]);
  const sel = new Set(value.units ?? avail);
  const countOf = new Map<string, number>();
  for (const c of courses) for (const b of c.bigs) for (const m of b.mids) countOf.set(m.id, m.n);
  if (g) countOf.set(g.etc.id, g.etc.n);
  const picked = avail.filter((id) => sel.has(id));
  const pickedN = picked.reduce((a, id) => a + (countOf.get(id) ?? 0), 0);

  const setUnits = (next: Set<string>) => {
    const arr = avail.filter((id) => next.has(id));
    onChange({ ...value, units: arr.length === avail.length ? null : arr });
  };
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    setUnits(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="label">학교급</p>
        <div className="flex flex-wrap gap-2">
          {allowAll && (
            <button type="button" className={chip(!value.level)} onClick={() => onChange({ level: "", grade: null, course: "", units: null })}>
              전체
            </button>
          )}
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              className={chip(value.level === l)}
              onClick={() => {
                const first = tree.find((x) => x.level === l);
                onChange(
                  allowAll
                    ? { level: l, grade: null, course: "", units: null }
                    : { level: l, grade: first?.grade ?? null, course: autoCourse(first), units: null }
                );
              }}
            >
              {l === "중" ? "중학교" : "고등학교"}
            </button>
          ))}
        </div>
      </div>

      {value.level && (
        <div className="space-y-1.5">
          <p className="label">학년</p>
          <div className="flex flex-wrap gap-2">
            {allowAll && (
              <button type="button" className={chip(!value.grade)} onClick={() => onChange({ ...value, grade: null, course: "", units: null })}>
                전체
              </button>
            )}
            {grades.map((x) => {
              const on = x.grade === value.grade;
              return (
                <button
                  key={x.grade}
                  type="button"
                  className={chip(on)}
                  onClick={() => onChange({ ...value, grade: x.grade, course: autoCourse(x), units: null })}
                >
                  {x.level}
                  {x.grade} <span className={sub(on)}>({x.n})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {g && (g.courses.length > 1 || g.etc.n > 0) && (
        <div className="space-y-1.5">
          <p className="label">과목</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(!value.course)} onClick={() => onChange({ ...value, course: "", units: null })}>
              전 과목 <span className={sub(!value.course)}>({g.n})</span>
            </button>
            {g.courses.map((c) => {
              const on = value.course === c.key;
              return (
                <button key={c.key} type="button" className={chip(on)} onClick={() => onChange({ ...value, course: c.key, units: null })}>
                  {c.name} <span className={sub(on)}>({c.n})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {g && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label">출제할 단원</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-500 tabular-nums">
                고른 단원 {picked.length}/{avail.length}개 · 문항 {pickedN}개
              </span>
              <button type="button" className="link-accent" onClick={() => setUnits(new Set(avail))}>
                모두 선택
              </button>
              <button type="button" className="link-accent" onClick={() => setUnits(new Set())}>
                모두 해제
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {courses.map((c) => (
              <div key={c.key} className="p-2 space-y-2">
                {courses.length > 1 && <p className="text-xs font-semibold text-slate-500">{c.name}</p>}
                {c.bigs.map((b, bi) => {
                  const ids = b.mids.filter((m) => m.n).map((m) => m.id);
                  const on = ids.filter((id) => sel.has(id)).length;
                  return (
                    <div key={bi} className="space-y-1">
                      <label className={"flex items-center gap-2 text-sm font-medium " + (ids.length ? "" : "text-slate-400")}>
                        <Tri
                          checked={ids.length > 0 && on === ids.length}
                          some={on > 0}
                          disabled={!ids.length}
                          onChange={() => toggle(ids, on < ids.length)}
                          label={`${b.name} 전체`}
                        />
                        <span>
                          {ROMAN[bi] ?? bi + 1}. {b.name}
                        </span>
                        <span className="text-xs font-normal text-slate-400 tabular-nums">({b.n})</span>
                      </label>
                      <div className="grid gap-x-3 gap-y-1 pl-6 sm:grid-cols-2">
                        {b.mids.map((m, mi) => (
                          <label key={m.id} className={"flex items-center gap-2 text-sm " + (m.n ? "text-slate-700" : "text-slate-300")}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0"
                              checked={!!m.n && sel.has(m.id)}
                              disabled={!m.n}
                              onChange={(e) => toggle([m.id], e.target.checked)}
                            />
                            <span className="min-w-0">
                              {mi + 1}. {m.name} <span className="text-xs text-slate-400 tabular-nums">({m.n})</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {showEtc && g && (
              <label className="flex items-center gap-2 p-2 text-sm text-slate-600">
                <input type="checkbox" className="h-4 w-4 shrink-0" checked={sel.has(g.etc.id)} onChange={(e) => toggle([g.etc.id], e.target.checked)} />
                기타(단원 분류가 안 된 문항) <span className="text-xs text-slate-400 tabular-nums">({g.etc.n})</span>
              </label>
            )}
          </div>
          <p className="text-xs text-slate-400">단원은 문항에 적힌 단원 이름을 교과서 단원표에 맞춰 자동으로 나눈 것입니다. 회색 단원은 아직 문항이 없습니다.</p>
        </div>
      )}
    </div>
  );
}

/** 주소(GET 폼)로 범위를 보낼 때: 고른 값을 숨은 칸(level·grade·course·u)으로 함께 보낸다(문항 은행 찾기 화면) */
export function ScopePickerForm({ tree, initial }: { tree: TreeGrade[]; initial: ScopeValue }) {
  const [v, setV] = useState<ScopeValue>(initial);
  return (
    <div>
      <ScopePicker tree={tree} value={v} onChange={setV} allowAll />
      {v.level && <input type="hidden" name="level" value={v.level} />}
      {v.grade ? <input type="hidden" name="grade" value={String(v.grade)} /> : null}
      {v.course && <input type="hidden" name="course" value={v.course} />}
      {v.units && <input type="hidden" name="u" value={v.units.join(",") || "none"} />}
    </div>
  );
}
