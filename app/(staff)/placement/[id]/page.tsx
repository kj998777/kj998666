import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { loadSubmissions, loadTestDetails, loadVisibleTest } from "@/lib/placement/server";
import { PlacementDetailView } from "@/app/_components/placement/PlacementViews";

export const dynamic = "force-dynamic";

// 입학테스트 자세히(0047): 시험지·정답지 PDF, 학생 제출 링크, 제출한 학생과 진단 보고서
export default async function PlacementDetailPage({ params }: { params: { id: string } }) {
  const session = await requireRole("editor");
  const test = await loadVisibleTest(params.id);
  if (!test) notFound();
  const details = await loadTestDetails(test);
  const submissions = await loadSubmissions(test, details);
  return (
    <PlacementDetailView
      test={test}
      details={details}
      submissions={submissions}
      canToggle={test.owner_id === session.userId || session.role === "admin"}
      backHref="/placement"
    />
  );
}
