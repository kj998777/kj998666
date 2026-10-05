import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSimilarPage, shortExamName } from "@/lib/similar/load";
import SimilarPractice from "./SimilarPractice";
import PromoBanner from "@/app/_components/PromoBanner";

// 오답 유사문제(2026-10-05): 학생이 시험을 제출한 뒤(제출 완료 화면 버튼) 또는 개별 성적 보고서의 QR로 들어온다.
// 로그인 없음 — 제출 id(추측할 수 없는 uuid)가 열쇠. 이름·점수·정답은 이 화면에 싣지 않는다.
// 틀린(무응답·찍어서 맞힌) 문항마다 같은 논리 유형의 다른 학교 문제를 난이도 한 단계 쉬운 것 → 같은 것 → 한 단계
// 어려운 것 순으로 보여 주고(lib/similar/recommend.ts), 답을 적으면 채점과 풀이를 보여 준다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "오답 유사문제 · 메딕차트", robots: { index: false, follow: false } };

export default async function SimilarPage({ params }: { params: { sid: string } }) {
  const page = await loadSimilarPage(createAdminClient(), params.sid);
  if (!page) {
    return (
      <Wrap>
        <div className="card text-center text-sm">찾을 수 없는 제출입니다. 받은 링크나 QR을 다시 확인해 주세요.</div>
      </Wrap>
    );
  }
  const withCards = page.groups.filter((g) => g.cards.length).length;
  return (
    <Wrap>
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-brand-700">오답 유사문제</p>
        <h1 className="text-lg font-semibold leading-snug">{shortExamName(page.examName)}</h1>
        {page.groups.length === 0 ? (
          <p className="text-sm text-slate-600">틀린 문항이 없습니다. 잘했어요!</p>
        ) : (
          <p className="text-sm text-slate-600">
            다시 볼 문항 {page.groups.length}개
            {withCards < page.groups.length ? ` (그중 ${withCards}개에 유사문제가 있어요)` : ""}. 같은 생각으로 푸는 다른 학교 문제를{" "}
            <b>한 단계 쉬운 것 → 같은 난이도 → 한 단계 어려운 것</b> 순서로 모았어요.
          </p>
        )}
      </div>
      {page.groups.length > 0 && <SimilarPractice page={page} />}
      <PromoBanner compact />
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">{children}</div>
    </div>
  );
}
