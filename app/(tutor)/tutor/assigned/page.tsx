import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { getMyActiveClaims } from "@/lib/tutor/claims";
import ReleaseClaimButton from "./ReleaseClaimButton";

export const dynamic = "force-dynamic";

// "맡은 문제" 탭(2026-09-29): 지금 배정받아 풀고 있는 문항을 다시 열 수 있게 모아 보여 준다.
// 휴대폰에서 다른 앱에 갔다 오면 검토 화면이 사라진 것처럼 보이던 문제 때문에 만들었다(lib/tutor/claims.ts 참고).
export default async function AssignedPage() {
  const session = await requireTutor();
  const claims = await getMyActiveClaims(session.userId);
  const now = Date.now();

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="card space-y-1">
        <h1 className="text-lg font-semibold">맡은 문제</h1>
        <p className="text-sm text-slate-500">
          배정받은 문항은 30분 동안 선생님 몫으로 남아 있습니다. 다른 앱에 다녀오거나 화면을 닫았다면 여기서 이어서 풀어 주세요.
          30분이 지나면 다른 선생님에게 넘어갑니다.
        </p>
      </div>

      {claims.length === 0 ? (
        <div className="card text-center space-y-3">
          <p className="text-sm text-slate-500">지금 맡고 있는 문제가 없습니다.</p>
          <Link href="/tutor/review" className="btn-primary inline-block">
            문항 받으러 가기
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => {
            const left = Math.max(0, Math.round((new Date(c.expiresAt).getTime() - now) / 60000));
            return (
              <li key={c.itemExplanationId + c.kind} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {c.examName} · {c.itemLabel}번
                  </div>
                  <div className={"text-xs " + (left <= 5 ? "text-red-600" : "text-slate-500")}>
                    {left > 0 ? `${left}분 남음` : "곧 만료"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/tutor/review/${c.itemExplanationId}?kind=${c.kind}`} className="btn-primary">
                    이어서 풀기
                  </Link>
                  <ReleaseClaimButton itemExplanationId={c.itemExplanationId} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
