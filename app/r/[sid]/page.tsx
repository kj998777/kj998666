import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSimilarPage, shortExamName } from "@/lib/similar/load";
import SimilarPractice from "./SimilarPractice";
import PromoBanner from "@/app/_components/PromoBanner";

// 오답 유사문제(2026-10-05): 선생님이 준 링크 또는 개별 성적 보고서의 QR로 들어온다.
// 같은 날 원장님 "학생이 아니라 선생님이 선택할 수 있게": 선생님이 고른 문제(submissions.similar_picks)만 보여 준다.
// 로그인 없음 — 제출 id(추측할 수 없는 uuid)가 열쇠. 이름·점수·정답은 이 화면에 싣지 않는다.
// 틀린(무응답·찍어서 맞힌) 문항마다 선생님이 고른 같은 논리 유형의 다른 학교 문제를 쉬운 것부터 보여 주고,
// 답을 적으면 채점과 풀이를 보여 준다.
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
  return (
    <Wrap>
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-brand-700">오답 유사문제</p>
        <h1 className="text-lg font-semibold leading-snug">{shortExamName(page.examName)}</h1>
        {page.targets === 0 ? (
          <p className="text-sm text-slate-600">틀린 문항이 없습니다. 잘했어요!</p>
        ) : page.pending ? (
          <p className="text-sm text-slate-600">선생님이 틀린 문항에 맞는 유사문제를 고르고 있어요. 골라 주시면 이 화면에 나오니 조금 뒤에 다시 열어 주세요.</p>
        ) : page.groups.length === 0 ? (
          <p className="text-sm text-slate-600">선생님이 고른 유사문제가 아직 없어요.</p>
        ) : (
          <p className="text-sm text-slate-600">
            선생님이 틀린 문항 {page.groups.length}개에 맞춰 <b>같은 생각으로 푸는 다른 학교 문제</b>를 골라 주셨어요. 쉬운 것부터 차례로 풀어
            보세요.
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
