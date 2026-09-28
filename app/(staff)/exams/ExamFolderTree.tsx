"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
};

const LEVEL_LABEL: Record<string, string> = { 초: "초등학교", 중: "중학교", 고: "고등학교" };

// 옛 학교별 기출 탭의 SCH_ALIAS 를 흉내낸 표 — 같은 학교를 가리키는 다른 표기를 하나로 합친다.
// 필요할 때마다 여기에 항목을 추가하면 된다.
const SCH_ALIAS: Record<string, string> = {
  제주제일고: "제주일고",
};

function normalizeSchool(raw: string): string {
  const s = raw.replace(/고등학교$/, "고");
  return SCH_ALIAS[s] ?? s;
}

// 시험 이름에서 학교 이름을 뽑아내는 옛 schoolOf() 흉내 — "…고" / "…고등학교" 형태의 토큰을 찾되,
// 괄호 밖 텍스트를 먼저 보고, 없으면 괄호 안을 본다. 둘 다 없으면 "학교 미상".
function schoolOf(name: string): string {
  const parenMatch = name.match(/\(([^)]*)\)/);
  const outside = parenMatch ? name.replace(parenMatch[0], "") : name;
  const inside = parenMatch ? parenMatch[1] : "";
  for (const text of [outside, inside]) {
    const m = text.match(/[가-힣]{2,20}(고등학교|고)(?![가-힣])/);
    if (m) return normalizeSchool(m[0]);
  }
  return "학교 미상";
}

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
    <li className="py-2 flex items-center justify-between gap-2 pl-2">
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
        className="w-full flex items-center justify-between gap-2 py-2 text-left hover:bg-slate-50 rounded px-1"
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

  const { years, unclassified } = useMemo(() => {
    const classified = exams.filter((e) => e.folder_year);
    const unclassified = exams.filter((e) => !e.folder_year);
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
          {years.length === 0 && unclassified.length === 0 && <p className="text-sm text-slate-500">해당하는 시험이 없습니다.</p>}
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
// 각 단계는 값이 없으면 "… 미지정" 폴더로 모은다.
type FolderLevel = { key: (e: ExamRow) => string; order: string[] };

const FOLDER_LEVELS: FolderLevel[] = [
  {
    key: (e) => (e.school_level ? LEVEL_LABEL[e.school_level] ?? e.school_level : "학교급 미지정"),
    order: ["초등학교", "중학교", "고등학교", "학교급 미지정"],
  },
  { key: (e) => (e.folder_grade ? `${e.folder_grade}학년` : "학년 미지정"), order: ["1학년", "2학년", "3학년", "학년 미지정"] },
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
      const i = level.order.indexOf(k);
      return i === -1 ? level.order.length - 1 : i;
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
          <NestedGroups exams={list} levels={rest} />
        </Folder>
      ))}
    </div>
  );
}
