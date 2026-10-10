"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { schoolOf } from "@/lib/exams/schoolOf";
import { setExamsStatus } from "./actions";

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

// 2026-10-10 원장님 "선택한 시험지 모두 열기": 관리자에게만 고르기 칸을 보여 주고, 고른 시험을 한꺼번에 열거나 닫는다.
// 검수 대기 시험은 검수 확정으로만 열리므로 고를 수 없다(한 개씩 여는 버튼과 같은 규칙).
type Selection = { selected: Set<string>; set: (codes: string[], on: boolean) => void };
const SelectionCtx = createContext<Selection | null>(null);
const selectable = (e: ExamRow) => e.status !== "검수대기";

function FolderCheck({ exams }: { exams: ExamRow[] }) {
  const sel = useContext(SelectionCtx);
  if (!sel) return null;
  const codes = exams.filter(selectable).map((e) => e.code);
  if (!codes.length) return <span className="w-[13px] shrink-0" />;
  const n = codes.filter((c) => sel.selected.has(c)).length;
  return (
    <input
      type="checkbox"
      className="shrink-0"
      aria-label="이 폴더 시험 모두 고르기"
      title="이 폴더 시험 모두 고르기"
      checked={n === codes.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < codes.length;
      }}
      onChange={(ev) => sel.set(codes, ev.target.checked)}
    />
  );
}

function SelectionBar({ exams }: { exams: ExamRow[] }) {
  const sel = useContext(SelectionCtx);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  if (!sel) return null;
  const codes = exams.filter((e) => sel.selected.has(e.code)).map((e) => e.code);
  const run = (open: boolean) =>
    start(async () => {
      setMsg("");
      const r = await setExamsStatus(codes, open);
      if (!r.ok) {
        setMsg(r.msg);
        return;
      }
      const parts = [`${r.changed}개를 ${open ? "열었" : "닫았"}습니다.`];
      if (r.already) parts.push(`이미 ${open ? "열림" : "닫힘"} ${r.already}개`);
      if (r.skippedNoKey) parts.push(`정답이 없어 못 연 시험 ${r.skippedNoKey}개`);
      if (r.skippedReview) parts.push(`검수 대기라 건너뜀 ${r.skippedReview}개`);
      if (r.missing) parts.push(`찾지 못함 ${r.missing}개`);
      setMsg(parts.join(" · "));
      sel.set(codes, false);
      router.refresh();
    });
  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white/95 px-3 py-2 text-sm">
      <span className="text-slate-600">
        {codes.length ? `${codes.length}개 고름` : "시험 왼쪽 칸을 눌러 고르세요 (폴더 칸은 그 폴더 전체)"}
      </span>
      {codes.length > 0 && (
        <>
          <button type="button" className="btn-primary" disabled={pending} onClick={() => run(true)}>
            {pending ? "처리 중…" : "선택한 시험 제출 열기"}
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(false)}>
            선택한 시험 제출 닫기
          </button>
          <button type="button" className="text-slate-500 underline" disabled={pending} onClick={() => sel.set(codes, false)}>
            선택 해제
          </button>
        </>
      )}
      {msg && <span className="w-full text-xs text-slate-700">{msg}</span>}
    </div>
  );
}

function ExamLeafRow({ x, showTermKind }: { x: ExamRow; showTermKind?: boolean }) {
  const sel = useContext(SelectionCtx);
  const termKind =
    x.folder_term || x.folder_kind
      ? `${x.folder_term ? `${x.folder_term}학기` : ""} ${x.folder_kind ?? ""}`.trim()
      : null;
  return (
    <li className="py-2 flex flex-wrap items-center justify-between gap-2 pl-2">
      <span className="flex items-center gap-2 min-w-0">
        {sel && (
          <input
            type="checkbox"
            className="shrink-0"
            aria-label={`${x.name} 고르기`}
            disabled={!selectable(x)}
            title={selectable(x) ? undefined : "검수 대기 시험은 검수 확정으로 열립니다."}
            checked={sel.selected.has(x.code)}
            onChange={(ev) => sel.set([x.code], ev.target.checked)}
          />
        )}
        <Link href={`/exams/${encodeURIComponent(x.code)}`} className="hover:underline min-w-0">
          <span className="font-medium">{x.name}</span> <span className="text-slate-400 text-sm">({x.code})</span>
        </Link>
      </span>
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
      <div className="flex items-center gap-1">
        <FolderCheck exams={exams} />
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
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

export default function ExamFolderTree({ exams, canSelect = false }: { exams: ExamRow[]; canSelect?: boolean }) {
  const [tab, setTab] = useState<"folder" | "school">("folder");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selection = useMemo<Selection | null>(
    () =>
      canSelect
        ? {
            selected,
            set: (codes, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                for (const c of codes) {
                  if (on) next.add(c);
                  else next.delete(c);
                }
                return next;
              }),
          }
        : null,
    [canSelect, selected]
  );

  // 0051(2026-10-05): 분류(collection)가 있는 시험도 연도 폴더 안에 둔다 —
  // 연도 → 학교급 → 학년 → 📚 분류(예: 부교재 변형문제) → 학교 → 시험 (2026-10-05 요청).
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
    <SelectionCtx.Provider value={selection}>
      <div>
        <SelectionBar exams={exams} />
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
    </SelectionCtx.Provider>
  );
}

// 폴더 순서(2026-09-28 원장님 요청): 연도 → 중학교/고등학교 → 학년 → 학기 → 중간/기말 → 시험.
// 분류(collection)가 있는 시험(2026-10-05): 연도 → 학교급 → 학년 → 📚 분류 → 학교 → 시험 — 학기 폴더들과 나란히, 맨 앞에 둔다.
// 각 단계는 값이 없으면 "… 미지정" 폴더로 모은다.
type FolderLevel = {
  key: (e: ExamRow) => string;
  order: string[];
  /** 이 단계의 폴더 이름에 따라 아래 단계를 바꿀 때(분류 폴더 아래는 학년 → 학교별로) */
  branch?: (label: string) => FolderLevel[] | undefined;
};

const COLLECTION_PREFIX = "📚 ";
const SCHOOL_LEVEL: FolderLevel = { key: (e) => schoolOf(e.name), order: [] }; // 가나다순, "학교 미상"은 맨 뒤(rank 참고)
// 연도 없는 분류 시험(맨 위 📚 폴더) 아래: 학년 → 학교 → 시험
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
    key: (e) => (e.folder_grade ? `${e.folder_grade}학년` : "학년 미지정"),
    order: ["1학년", "2학년", "3학년", "학년 미지정"],
  },
  {
    key: (e) => (e.collection ? COLLECTION_PREFIX + e.collection : e.folder_term ? `${e.folder_term}학기` : "학기 미지정"),
    order: ["1학기", "2학기", "학기 미지정"],
    branch: (label) => (label.startsWith(COLLECTION_PREFIX) ? [SCHOOL_LEVEL] : undefined),
  },
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
      if (k.startsWith(COLLECTION_PREFIX)) return -1; // 📚 분류 폴더는 학기 폴더들보다 앞에
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
