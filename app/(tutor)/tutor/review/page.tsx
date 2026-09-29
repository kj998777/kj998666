import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { getMyActiveClaims } from "@/lib/tutor/claims";
import ReviewQueueClient from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

// 검토하기 첫 화면. 2026-09-29: 이미 맡고 있는 문항이 있으면(다른 앱에 갔다 와서 화면이 새로 열린 경우 등) 먼저 그 문항으로
// 돌아갈 수 있게 보여 준다(맡은 문제 탭과 같은 목록, lib/tutor/claims.ts).
export default async function ReviewQueuePage() {
  const session = await requireTutor();
  const claims = await getMyActiveClaims(session.userId).catch(() => []);
  return (
    <div className="space-y-4">
      {claims.length > 0 && (
        <div className="card border-amber-300 bg-amber-50 max-w-lg mx-auto space-y-2">
          <p className="text-sm text-amber-900 font-medium">풀고 있던 문제가 있습니다</p>
          <ul className="space-y-1">
            {claims.map((c) => (
              <li key={c.itemExplanationId + c.kind} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {c.examName} · {c.itemLabel}번
                </span>
                <Link href={`/tutor/review/${c.itemExplanationId}?kind=${c.kind}`} className="btn-primary py-1 px-3 text-sm">
                  이어서 풀기
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReviewQueueClient />
    </div>
  );
}
