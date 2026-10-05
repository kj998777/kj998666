"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { schoolOf } from "@/lib/exams/schoolOf";

export type ExamRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  school_level: string | null;
  folder_year: string | null;
  folder_grade: number | null;
  folder_term: number | null;
  folder_kind: "중간" | "기말" | "기타" | null;
  collection?: string | null; // 0051: 학교 기출이 아닌 자체 자료 모음(예: 부교재 변형문제)
};

const LEVEL_LABEL: Record<string, string> = { 중: "중학교", 고: "고등학교" }; // 초등학교는 뺌(2026-10-03)

function statusBadgeClass(status: string) {
  return status === "열림"
    ? "bg-emerald-100 text-emerald-700"
    : status === "검수대기"
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";
}

function StatusCounts({ exams }: { exams: ExamRow[] }) {
  const open = exams.filter((e) => e.status === "열림").length;
  const pending = exams.filter((e) => e.status === "검수대기").length;
  const closed = exams.length - open - pending;
  return (
    <span className="flex gap-1 text-xs shrink-0">
      {pending > 0 && <span className="badge bg-amber-100 text-amber-700">검수 대기 {pending}</span>}
      {closed > 0 && <span className="badge bg-slate-100 text-slate-600">닫힘 {closed}</span>}
      {open > 0 && <span className="badge bg-emerald-100 text-emerald-700">열림 {open}</span>}
    </span>
  );
}

function ExamLeafRow({ x, showTermKind }: { x: ExamRow; showTermKind?: boolean }) {
  const termKind =
    x.folder_term || x.folder_kind
      ? `${x.folder_term ? `${x.folder_term}학기` : ""} ${x.folder_kind ?? ""}`.trim()
      : null;
  return (
    <li className="py-2 flex flex-wrap items-center justify-between gap-2 pl-2">
      <Link href={`/exams/${encodeURIComponent(x.code)}`} className="hover:underline min-w-0">
        <span className="font-medium">{x.name}</span> <span className="text-slate-400 text-sm">({x.code})</span>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        {showTermKind && termKind && <span className="badge bg-slate-100 text-slate-500">{termKind}</span>}
        {x.school_level && <span className="badge bg-sky-100 text-sky-700">{LEVEL_LABEL[x.school_level] ?? x.school_level}</span>}
        <span className={"badge " + statusBadgeClass(x.status)}>{x.status}</span>
      </div>
    </li>
  );
}

function Folder({
  id,
  label,
  exams,
  defaultOpen,
  children,
}: {
  id: string;
  label: string;
  exams: ExamRow[];
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        className="w-full flex flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-slate-50 rounded px-1"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="text-slate-400 text-xs w-3 inline-block">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-slate-400">({exams.length})</span>
        </span>
        <StatusCounts exams={exams} />
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

export default function ExamFolderTree({ exams }: { exams: ExamRow[] }) {
  const [tab, setTab] = useState<"folder" | "school">("folder");

  // 0051(2026-10-05): 분류(collection)가 있는 시험도 연도 폴더 안에 둔다 —
  // 연도 → 학교급 → 📚 분류(예: 부교재 변형문제) → 학년 → 학교 → 시험 (2026-10-05 요청).
  // 연도가 없는 분류 시험만 맨 위 📚 분류 폴더에 모은다.
  const collections = useMemo(() => {
    const map = new Map<string, ExamRow[]>();
    for (const e of exams) {
      if (!e.collection || e.folder_year) continue;
      const list = map.get(e.collection) ?? [];
      list.push(e);
      map.set(e.collection, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [exams]);

  const { years, unclassified } = useMemo(() => {
    const classified = exams.filter((e) => e.folder_year);
    const unclassified = exams.filter((e) => !e.folder_year && !e.collection);
    const byYear = new Map<string, ExamRow[]>();
    for (const e of classified) {
      const list = byYear.get(e.folder_year!) ?? [];
      list.push(e);
      byYear.set(e.folder_year!, list);
    }
    const years = Array.from(byYear.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, list]) => ({ year, exams: list }));
    return { years, unclassified };
  }, [exams]);

  const bySchool = useMemo(() => {
    const map = new Map<string, ExamRow[]>();
    for (const e of exams) {
      const school = schoolOf(e.name);
      const list = map.get(school) ?? [];
      list.push(e);
      map.set(school, list);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "학교 미상") return 1;
      if (b[0] === "학교 미상") return -1;
      return a[0].localeCompare(b[0], "ko");
    });
  }, [exams]);

  return (
    <div>
      <div className="flex gap-1 text-sm mb-3">
        <button
          type="button"
          onClick={() => setTab("folder")}
          className={"badge " + (tab === "folder" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
        >
          연도·학교급·학년별
        </button>
        <button
          type="button"
          onClick={() => setTab("school")}
          className={"badge " + (tab === "school" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
        >
          학교별 기출
        </button>
      </div>

      {tab === "folder" && (
        <div>
          {years.length === 0 && unclassified.length === 0 && collections.length === 0 && (
            <p className="text-sm text-slate-500">해당하는 시험이 없습니다.</p>
          )}
          {collections.map(([name, list]) => (
            <Folder key={"c:" + name} id={"c:" + name} label={`📚 ${name}`} exams={list} defaultOpen={false}>
              <NestedGroups exams={list} levels={COLLECTION_LEVELS} />
            </Folder>
          ))}
          {years.map((y, idx) => (
            <Folder key={y.year} id={y.year} label={`${y.year}년`} exams={y.exams} defaultOpen={idx === 0}>
              <NestedGroups exams={y.exams} levels={FOLDER_LEVELS} />
            </Folder>
          ))}
          {unclassified.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-slate-400 mb-1 px-1">폴더 미분류</p>
              <ul className="divide-y divide-slate-100">
                {unclassified.map((x) => (
                  <ExamLeafRow key={x.id} x={x} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "school" && (
        <div>
          {bySchool.length === 0 && <p className="text-sm text-slate-500">해당하는 시험이 없습니다.</p>}
          {bySchool.map(([school, list]) => (
            <Folder key={school} id={school} label={school} exams={list} defaultOpen={false}>
              <ul className="divide-y divide-slate-100">
                {list.map((x) => (
                  <ExamLeafRow key={x.id} x={x} showTermKind />
                ))}
              </ul>
            </Folder>
          ))}
        </div>
      )}
    </div>
  );
}

// 폴더 순서(2026-09-28 원장님 요청): 연도 → 중학교/고등학교 → 학년 → 학기 → 중간/기말 → 시험.
// 분류(collection)가 있는 시험(2026-10-05): 연도 → 학교급 → 📚 분류 → 학년 → 학교 → 시험 — 학년 폴더들과 나란히, 맨 앞에 둔다.
// 각 단계는 값이 없으면 "… 미지정" 폴더로 모은다.
type FolderLevel = {
  key: (e: ExamRow) => string;
  order: string[];
  /** 이 단계의 폴더 이름에 따라 아래 단계를 바꿀 때(분류 폴더 아래는 학년 → 학교별로) */
  branch?: (label: string) => FolderLevel[] | undefined;
};

const COLLECTION_PREFIX = "📚 ";
const SCHOOL_LEVEL: FolderLevel = { key: (e) => schoolOf(e.name), order: [] }; // 가나다순, "학교 미상"은 맨 뒤(rank 참고)
// 분류 폴더 아래(2026-10-05 요청): 학년 → 학교 → 시험
const GRADE_LEVEL: FolderLevel = {
  key: (e) => (e.folder_grade ? `${e.folder_grade}학년` : "학년 미지정"),
  order: ["1학년", "2학년", "3학년", "학년 미지정"],
};
const COLLECTION_LEVELS: FolderLevel[] = [GRADE_LEVEL, SCHOOL_LEVEL];

const FOLDER_LEVELS: FolderLevel[] = [
  {
    key: (e) => (e.school_level ? LEVEL_LABEL[e.school_level] ?? e.school_level : "학교급 미지정"),
    order: ["중학교", "고등학교", "학교급 미지정"], // 2026-10-03: 초등학교 폴더는 뺌
  },
  {
    key: (e) => (e.collection ? COLLECTION_PREFIX + e.collection : e.folder_grade ? `${e.folder_grade}학년` : "학년 미지정"),
    order: ["1학년", "2학년", "3학년", "학년 미지정"],
    branch: (label) => (label.startsWith(COLLECTION_PREFIX) ? COLLECTION_LEVELS : undefined),
  },
  { key: (e) => (e.folder_term ? `${e.folder_term}학기` : "학기 미지정"), order: ["1학기", "2학기", "학기 미지정"] },
  { key: (e) => e.folder_kind ?? "구분 미지정", order: ["중간", "기말", "기타", "구분 미지정"] },
];

function NestedGroups({ exams, levels }: { exams: ExamRow[]; levels: FolderLevel[] }) {
  const [level, ...rest] = levels;
  const groups = useMemo(() => {
    if (!level) return [];
    const map = new Map<string, ExamRow[]>();
    for (const e of exams) {
      const k = level.key(e);
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    const rank = (k: string) => {
      if (k.startsWith(COLLECTION_PREFIX)) return -1; // 📚 분류 폴더는 학년 폴더들보다 앞에
      if (k === "학교 미상") return 1;
      const i = level.order.indexOf(k);
      return i === -1 ? (level.order.length ? level.order.length - 1 : 0) : i;
    };
    return Array.from(map.entries()).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], "ko"));
  }, [exams, level]);

  if (!level) {
    return (
      <ul className="divide-y divide-slate-100">
        {[...exams]
          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
          .map((x) => (
            <ExamLeafRow key={x.id} x={x} />
          ))}
      </ul>
    );
  }

  return (
    <div>
      {groups.map(([label, list]) => (
        <Folder key={label} id={label} label={label} exams={list} defaultOpen={groups.length === 1}>
          <NestedGroups exams={list} levels={level.branch?.(label) ?? rest} />
        </Folder>
      ))}
    </div>
  );
}
