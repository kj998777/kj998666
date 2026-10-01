import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { loadPool } from "@/lib/placement/server";
import { listVisibleTests } from "@/lib/placement/list";
import { scopeTree, TUTOR_PLACEMENT_COST } from "@/lib/placement/pick";
import PlacementBuilder from "@/app/_components/placement/PlacementBuilder";
import { PlacementList } from "@/app/_components/placement/PlacementViews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 과외선생님 입학테스트(2026-10-01, 0047): 새로 맡은 학생의 실력을 보는 10문항 안팎 테스트. 기출 스토어 시험의 문항에서 고르고, 한 번 만들 때 2P.
export default async function TutorPlacementPage() {
  const session = await requireTutor();
  const supabase = await createClient();
  const [pool, { tests, counts }, { data: stats }] = await Promise.all([
    loadPool({ kind: "tutor", userId: session.userId }),
    listVisibleTests({ ownerId: session.userId }),
    supabase.from("tutor_stats").select("points_balance").eq("tutor_id", session.userId).maybeSingle(),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/tutor/worksheet" className="text-sm link-accent">
          ← 맞춤 시험지
        </Link>
        <h1 className="text-lg font-semibold mt-1">입학테스트</h1>
        <p className="text-sm text-slate-500">
          새로 맡은 학생의 실력을 보는 테스트입니다. 학교급·학년·과목과 출제할 단원(대단원·중단원)을 고르면 기출 스토어 시험의 문항에서 쉬운 문항부터 어려운 문항까지 고르게 뽑아 줍니다.
          만들면(<b>{TUTOR_PLACEMENT_COST}P</b>) 시험지(앞 표지, 맨 뒤 답 제출 QR)·정답지를 받을 수 있고, 학생이 QR로 답을 내면 바로 채점돼 <b>진단 보고서</b>
          (단원·난이도별 결과, 추천 수업 단계)가 나옵니다. 만든 테스트는 몇 번이든 다시 받을 수 있어요.
        </p>
      </div>
      <PlacementList tests={tests} counts={counts} base="/tutor/placement" />
      <PlacementBuilder
        tree={scopeTree(pool)}
        kind="tutor"
        cost={TUTOR_PLACEMENT_COST}
        balance={Number((stats as any)?.points_balance ?? 0)}
        detailBase="/tutor/placement"
      />
    </div>
  );
}
