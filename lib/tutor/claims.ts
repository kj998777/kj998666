import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 과외선생님이 지금 맡고 있는(배정받은) 문항 목록 — 2026-09-29 원장님 제보: 휴대폰에서 다른 앱에 갔다 오면(브라우저가
// 화면을 새로 불러오면서) 배정받은 문제가 사라진 것처럼 보였다. 배정 자체는 1시간(0027 전에는 30분) 동안 그 선생님에게 남아 있는데,
// "검토하기" 화면은 새 문항 받기 버튼만 있어서 돌아갈 길이 없었고, 다시 누르면 다른 문항이 배정돼 앞 문항은 30분 동안
// 아무도 못 푸는 상태로 묶였다.
//
// 사후검증 배정(tutor_item_reviews.verify_claimed_by)은 원 제출자의 기록이라 과외선생님 세션으로는 읽을 수 없으므로,
// 로그인한 선생님 id로 거른 뒤 서비스롤로 읽는다. 화면에는 새 문항/사후검증 구분을 보여 주지 않는다(블라인드 재검증).

export type ActiveClaim = {
  itemExplanationId: string;
  kind: "primary" | "verify";
  examName: string;
  itemLabel: string;
  expiresAt: string;
};

export async function getMyActiveClaims(tutorId: string): Promise<ActiveClaim[]> {
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();
  const [{ data: prim }, { data: ver }, { data: gold }] = await Promise.all([
    admin
      .from("item_explanations")
      .select("id, exam_id, item_label, claim_expires_at")
      .eq("claimed_by", tutorId)
      .gt("claim_expires_at", now)
      .eq("tutor_reviewed", false)
      .eq("review_confirmed", false)
      .limit(50),
    admin
      .from("tutor_item_reviews")
      .select("item_explanation_id, exam_id, item_label, verify_claim_expires_at")
      .eq("kind", "primary")
      .eq("verify_claimed_by", tutorId)
      .gt("verify_claim_expires_at", now)
      .eq("verified", false)
      .limit(50),
    // 0037: 정답 아는 문항(열린 시험의 문항) — 화면에는 새 문항과 똑같이 보인다
    admin
      .from("tutor_gold_attempts")
      .select("item_explanation_id, exam_id, item_label, claim_expires_at")
      .eq("tutor_id", tutorId)
      .is("submitted_at", null)
      .eq("released", false)
      .gt("claim_expires_at", now)
      .limit(10),
  ]);
  const rows: { id: string; exam: string; label: string; exp: string; kind: "primary" | "verify"; gold?: boolean }[] = [
    ...((gold as any[]) ?? []).map((r) => ({
      id: r.item_explanation_id,
      exam: r.exam_id,
      label: r.item_label,
      exp: r.claim_expires_at,
      kind: "primary" as const,
      gold: true,
    })),
    ...((prim as any[]) ?? []).map((r) => ({ id: r.id, exam: r.exam_id, label: r.item_label, exp: r.claim_expires_at, kind: "primary" as const })),
    ...((ver as any[]) ?? []).map((r) => ({
      id: r.item_explanation_id,
      exam: r.exam_id,
      label: r.item_label,
      exp: r.verify_claim_expires_at,
      kind: "verify" as const,
    })),
  ];
  if (!rows.length) return [];
  const examIds = Array.from(new Set(rows.map((r) => r.exam)));
  const { data: exams } = (await admin.from("exams").select("id, name, status").in("id", examIds)) as any;
  const byId = new Map(((exams as any[]) ?? []).map((e) => [e.id, e]));
  return rows
    .filter((r) => r.gold || byId.get(r.exam)?.status === "검수대기") // 그사이 열린(검토 끝난) 시험은 뺀다
    .sort((a, b) => a.exp.localeCompare(b.exp))
    .map((r) => ({
      itemExplanationId: r.id,
      kind: r.kind,
      examName: byId.get(r.exam)?.name ?? "시험",
      itemLabel: String(r.label),
      expiresAt: r.exp,
    }));
}
