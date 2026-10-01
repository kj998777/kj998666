import { CONTENT_KIND_LABEL, type ContentKind } from "@/lib/content/kinds";

// 2026-10-01: 학교 기출 원본 / 메딕 해설 구분 배지(lib/content/kinds.ts)
export default function ContentKindBadge({ kind }: { kind: ContentKind }) {
  const cls =
    kind === "medic" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-300 bg-slate-50 text-slate-600";
  return (
    <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap " + cls}>
      {CONTENT_KIND_LABEL[kind]}
    </span>
  );
}
