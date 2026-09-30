import { NextResponse } from "next/server";
import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { getMyActiveClaims } from "@/lib/tutor/claims";

// 과외선생님 화면 위쪽의 "포인트"·"맡은 문제" 숫자를 새로 읽는다(2026-09-30 원장님 제보: 검토를 제출해도 오른쪽 위 포인트가
// 그대로였음). 검토 제출이 고정 주소 API(/api/tutor/review)로 바뀐 뒤로는 제출해도 레이아웃이 다시 그려지지 않아서,
// 화면의 숫자 칸(TutorHeaderStats)이 제출·화면 이동·앱으로 돌아올 때 이 주소로 다시 읽는다.
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;
  const supabase = await createClient();
  const [{ data: stats }, claims] = await Promise.all([
    supabase.from("tutor_stats").select("points_balance").eq("tutor_id", auth.session.userId).maybeSingle(),
    getMyActiveClaims(auth.session.userId)
      .then((c) => c.length)
      .catch(() => null),
  ]);
  return NextResponse.json(
    { ok: true, points: Number((stats as any)?.points_balance ?? 0), claims },
    { headers: { "Cache-Control": "no-store" } }
  );
}
