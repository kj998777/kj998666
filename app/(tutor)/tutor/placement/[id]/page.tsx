import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { loadSubmissions, loadTestDetails, loadVisibleTest } from "@/lib/placement/server";
import { PlacementDetailView } from "@/app/_components/placement/PlacementViews";

export const dynamic = "force-dynamic";

// 과외선생님 입학테스트 자세히(0047) — 본인 테스트만(RLS)
export default async function TutorPlacementDetailPage({ params }: { params: { id: string } }) {
  const session = await requireTutor();
  const test = await loadVisibleTest(params.id);
  if (!test || test.owner_id !== session.userId) notFound();
  const details = await loadTestDetails(test);
  const submissions = await loadSubmissions(test, details);
  return <PlacementDetailView test={test} details={details} submissions={submissions} canToggle backHref="/tutor/placement" />;
}
