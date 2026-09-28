import Link from "next/link";

// #4: 구매한 시험의 관리 화면 상단 탭 — 기출문제 다운로드 / 제출 학생·보고서 / 해설·정답 수정 요청.
const TABS = [
  { key: "download", label: "기출문제 다운로드", suffix: "" },
  { key: "results", label: "제출 학생·보고서", suffix: "/results" },
  { key: "edit", label: "해설·정답 수정 요청", suffix: "/edit" },
] as const;

export default function TutorExamTabs({
  code,
  name,
  active,
}: {
  code: string;
  name: string;
  active: (typeof TABS)[number]["key"];
}) {
  const base = `/tutor/store/${encodeURIComponent(code)}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {name} <span className="text-slate-400 text-sm font-normal">({code})</span>
        </h1>
        <Link href="/tutor/store/purchases" className="text-sm link-accent whitespace-nowrap">
          ← 구매 내역
        </Link>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={base + t.suffix}
            className={
              "px-3 py-2 text-sm -mb-px border-b-2 " +
              (t.key === active ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
