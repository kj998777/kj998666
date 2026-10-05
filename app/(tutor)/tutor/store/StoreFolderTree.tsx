"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PurchaseButton from "./PurchaseButton";
import { schoolOf } from "@/lib/exams/schoolOf";

// 기출 스토어 폴더 보기(2026-09-28 원장님 요청: "기출스토어도 폴더기능 도입").
// 직원 시험 목록(app/(staff)/exams/ExamFolderTree.tsx)과 같은 순서로 나눈다:
// 연도 → 중학교/고등학교 → 학년 → 학기 → 중간/기말 → 시험. 값이 없는 단계는 "… 미지정" 폴더로 모으고,
// 연도가 없는 시험은 맨 아래 "폴더 미분류"에 둔다.
// 분류(collection)가 있는 시험(2026-10-05): 연도 → 학교급 → 📚 분류 → 학년 → 학교 → 시험. 연도가 없으면 맨 위 📚 분류 폴더.

export type StoreExam = {
  id: string;
  code: string;
  name: string;
  cost: number | null;
  owned: boolean;
  hasPdf: boolean;
  school_level: string | null;
  folder_year: string | null;
  folder_grade: number | null;
  folder_term: number | null;
  folder_kind: string | null;
  collection?: string | null; // 0051: 학교 기출이 아닌 메딕수학 자료 모음(예: 부교재 변형문제)
};

const LEVEL_LABEL: Record<string, string> = { 중: "중학교", 고: "고등학교" }; // 초등학교는 뺌(2026-10-03)

type Level = {
  key: (e: StoreExam) => string;
  order: string[];
  /** 이 단계의 폴더 이름에 따라 아래 단계를 바꿀 때(분류 폴더 아래는 학년 → 학교별로) */
  branch?: (label: string) => Level[] | undefined;
};

const COLLECTION_PREFIX = "📚 ";
const SCHOOL_LEVEL: Level = { key: (e) => schoolOf(e.name), order: [] }; // 가나다순, "학교 미상"은 맨 뒤
// 분류 폴더 아래(2026-10-05 요청): 학년 → 학교 → 시험
const GRADE_LEVEL: Level = {
  key: (e) => (e.folder_grade ? `${e.folder_grade}학년` : "학년 미지정"),
  order: ["1학년", "2학년", "3학년", "학년 미지정"],
};
const COLLECTION_LEVELS: Level[] = [GRADE_LEVEL, SCHOOL_LEVEL];

const LEVELS: Level[] = [
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

function Counts({ exams }: { exams: StoreExam[] }) {
  const owned = exams.filter((e) => e.owned).length;
  return (
    <span className="flex gap-1 text-xs shrink-0">
      {owned > 0 && <span className="badge bg-emerald-100 text-emerald-700">구매함 {owned}</span>}
    </span>
  );
}

function Folder({
  label,
  exams,
  defaultOpen,
  children,
}: {
  label: string;
  exams: StoreExam[];
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
        <Counts exams={exams} />
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

function ExamRow({ e }: { e: StoreExam }) {
  return (
    <li className="py-2 pl-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="min-w-0">
        {e.name} <span className="text-slate-400">({e.code})</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {e.owned ? (
          <>
            <span className="text-emerald-600">구매함</span>
            {/* #4: 구매한 시험은 관리 화면(다운로드 / 제출 학생·보고서 / 수정 요청)으로 */}
            <Link href={`/tutor/store/${encodeURIComponent(e.code)}`} className="btn-secondary py-1 px-3 inline-block">
              관리하기
            </Link>
          </>
        ) : e.hasPdf && e.cost != null ? (
          <PurchaseButton examId={e.id} examCode={e.code} cost={e.cost} />
        ) : (
          <>
            {e.cost != null && <span className="text-slate-500">{e.cost}P</span>}
            <span className="text-xs text-slate-400">PDF 준비 중</span>
          </>
        )}
      </span>
    </li>
  );
}

function Nested({ exams, levels }: { exams: StoreExam[]; levels: Level[] }) {
  const [level, ...rest] = levels;
  const groups = useMemo(() => {
    if (!level) return [];
    const map = new Map<string, StoreExam[]>();
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
          .map((e) => (
            <ExamRow key={e.id} e={e} />
          ))}
      </ul>
    );
  }

  return (
    <div>
      {groups.map(([label, list]) => (
        <Folder key={label} label={label} exams={list} defaultOpen={groups.length === 1}>
          <Nested exams={list} levels={level.branch?.(label) ?? rest} />
        </Folder>
      ))}
    </div>
  );
}

export default function StoreFolderTree({ exams }: { exams: StoreExam[] }) {
  const [view, setView] = useState<"folder" | "list">("folder");

  const { years, unclassified, collections } = useMemo(() => {
    const byYear = new Map<string, StoreExam[]>();
    const byCollection = new Map<string, StoreExam[]>();
    const unclassified: StoreExam[] = [];
    for (const e of exams) {
      // 0051(2026-10-05): 분류(collection)가 있어도 연도가 있으면 연도 폴더 안(학교급 아래 📚 폴더)으로,
      // 연도가 없을 때만 맨 위 분류 폴더로
      if (e.collection && !e.folder_year) {
        const list = byCollection.get(e.collection) ?? [];
        list.push(e);
        byCollection.set(e.collection, list);
        continue;
      }
      if (!e.folder_year) {
        unclassified.push(e);
        continue;
      }
      const list = byYear.get(e.folder_year) ?? [];
      list.push(e);
      byYear.set(e.folder_year, list);
    }
    const years = Array.from(byYear.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    const collections = Array.from(byCollection.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
    return { years, unclassified, collections };
  }, [exams]);

  return (
    <div>
      <div className="flex gap-1 text-sm mb-3">
        <button
          type="button"
          onClick={() => setView("folder")}
          className={"badge " + (view === "folder" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
        >
          폴더로 보기
        </button>
        <button
          type="button"
          onClick={() => setView("list")}
          className={"badge " + (view === "list" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
        >
          전체 목록
        </button>
      </div>

      {view === "list" ? (
        <Nested exams={exams} levels={[]} />
      ) : (
        <div>
          {collections.map(([name, list]) => (
            <Folder key={"c:" + name} label={`📚 ${name}`} exams={list} defaultOpen={false}>
              <Nested exams={list} levels={COLLECTION_LEVELS} />
            </Folder>
          ))}
          {years.map(([year, list], idx) => (
            <Folder key={year} label={`${year}년`} exams={list} defaultOpen={idx === 0}>
              <Nested exams={list} levels={LEVELS} />
            </Folder>
          ))}
          {unclassified.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-slate-400 mb-1 px-1">폴더 미분류</p>
              <Nested exams={unclassified} levels={[]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
