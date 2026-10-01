import { PROMO } from "@/lib/content/promo";

// 2026-10-01: 메딕수학 홍보 배너(학원 학생 답 제출 완료 화면 등). 문구·주소는 lib/content/promo.ts 한 곳에서.
export default function PromoBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-left space-y-2">
      <p className="text-xs font-semibold tracking-wide text-rose-700">{PROMO.name}</p>
      <p className="text-lg font-bold text-slate-900 leading-snug">{PROMO.headline}</p>
      {!compact && <p className="text-sm text-slate-600">{PROMO.sub}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <a href={PROMO.siteUrl} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
          학원 둘러보기
        </a>
        <a href={PROMO.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
          입학 테스트 신청
        </a>
        <a href={PROMO.blogUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
          공부법 블로그
        </a>
      </div>
      <p className="text-xs text-slate-500">
        상담 <a href={`tel:${PROMO.phone.replace(/-/g, "")}`} className="underline">{PROMO.phone}</a> · {PROMO.address}
      </p>
    </div>
  );
}
