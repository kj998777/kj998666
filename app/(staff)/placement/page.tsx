import { requireRole } from "@/lib/auth/requireRole";
import { loadPool } from "@/lib/placement/server";
import { listVisibleTests } from "@/lib/placement/list";
import { scopeTree } from "@/lib/placement/pick";
import PlacementBuilder from "@/app/_components/placement/PlacementBuilder";
import { PlacementList } from "@/app/_components/placement/PlacementViews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 입학테스트(2026-10-01 원장님 요청, 0047): 학년·과목을 고르면 검토 끝난 기출에서 10문항 안팎을 골라
// 시험지(앞 표지, 맨 뒤 답 제출 QR)·정답지·학생별 진단 보고서까지 만든다. 학원 테스트는 직원 모두가 함께 본다.
export default async function PlacementPage() {
  const session = await requireRole("editor");
  const [pool, { tests, counts }] = await Promise.all([loadPool({ kind: "staff", userId: session.userId }), listVisibleTests({ kind: "staff" })]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">입학테스트</h1>
        <p className="text-sm text-slate-500">
          학교급·학년·과목과 출제할 단원(대단원·중단원)을 고르면 검토가 끝난 기출 문항에서 쉬운 문항부터 어려운 문항까지 고르게 뽑아 줍니다. 마음에 안 드는 문항은 바꾸고 만들면, 시험지(앞 표지, 맨
          뒤 답 제출 QR)·정답지를 받을 수 있고 학생이 QR로 답을 내면 바로 채점돼 <b>진단 보고서</b>(단원·난이도별 결과, 추천 수업 단계)가 나옵니다.
        </p>
      </div>
      <PlacementList tests={tests} counts={counts} base="/placement" />
      <PlacementBuilder tree={scopeTree(pool)} kind="staff" cost={0} detailBase="/placement" />
    </div>
  );
}
