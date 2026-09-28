"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/supabase/types";
import { normalizeCohort } from "@/lib/profile/label";

function isRole(v: unknown): v is Role {
  return v === "admin" || v === "editor" || v === "viewer" || v === "tutor";
}

// 과외선생님으로 처음 승인(또는 초대)될 때 한 번 주는 환영 포인트(2026-09-28 원장님 요청 2).
// 기출 1개(3P)를 바로 받아 볼 수 있게 3P. 포인트 기록이 하나도 없는 계정에만 준다(중복 지급 방지).
const TUTOR_WELCOME_POINTS = 3; // "use server" 파일은 async 함수만 export할 수 있으므로 내보내지 않는다

/** 원래 다른 역할이었다가 tutor가 된 계정은 tutor_stats 행이 없을 수 있다 — 없으면 만든다. */
async function ensureTutorStats(userId: string) {
  const admin = createAdminClient();
  await (admin.from("tutor_stats") as any).upsert({ tutor_id: userId }, { onConflict: "tutor_id", ignoreDuplicates: true });
}

/** 포인트 기록이 전혀 없는 과외선생님 계정에 환영 포인트를 준다. 준 포인트(0이면 안 줌)를 돌려준다. */
async function grantWelcomePoints(userId: string): Promise<number> {
  if (TUTOR_WELCOME_POINTS <= 0) return 0;
  const admin = createAdminClient();
  const { count } = await (admin.from("tutor_points_ledger") as any)
    .select("id", { count: "exact", head: true })
    .eq("tutor_id", userId);
  if ((count ?? 0) > 0) return 0;
  // admin_adjust_tutor_points는 내부에서 is_admin()을 보므로 반드시 관리자 세션 클라이언트로 부른다.
  const supabase = await createClient();
  const { error } = await (supabase.rpc as any)("admin_adjust_tutor_points", {
    p_tutor_id: userId,
    p_delta: TUTOR_WELCOME_POINTS,
    p_note: "가입 환영 포인트",
  });
  return error ? 0 : TUTOR_WELCOME_POINTS;
}

/**
 * 새 계정 초대: 이메일로 로그인 링크가 담긴 초대 메일을 보내고, 원하는 역할을 함께 지정한다.
 * 0021부터 가입 트리거는 요청에 담긴 role을 믿지 않고 항상 '대기'로 만들므로(회원가입으로 관리자
 * 권한을 얻는 구멍 차단), 초대 직후 여기서 서비스롤로 권한을 따로 지정한다.
 */
export async function inviteUser(formData: FormData) {
  await requireRole("admin"); // 이중 방어: 이 화면은 admin만 보이지만, 액션 자체도 다시 검사

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 30);
  const cohort = normalizeCohort(String(formData.get("cohort") ?? ""));
  if (!email) return { ok: false, msg: "이메일을 입력해 주세요." };
  if (!isRole(role)) return { ok: false, msg: "역할 값이 올바르지 않습니다." };

  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName || undefined, cohort: cohort || undefined },
    redirectTo: `${siteUrl}/auth/callback`,
  });

  if (error) return { ok: false, msg: "초대 메일을 보내지 못했습니다: " + error.message };

  const userId = data?.user?.id;
  if (!userId) return { ok: false, msg: "초대는 보냈지만 계정 정보를 받지 못해 권한을 지정하지 못했습니다. 계정 목록에서 직접 지정해 주세요." };
  const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (roleErr) return { ok: false, msg: "초대는 보냈지만 권한을 지정하지 못했습니다: " + roleErr.message };
  // 이름·기수 열(0021)이 아직 없어도 초대 자체는 성공으로 둔다.
  if (displayName || cohort) {
    await admin
      .from("profiles")
      .update({ display_name: displayName || null, cohort: cohort || null })
      .eq("id", userId);
  }

  let welcome = 0;
  if (role === "tutor") {
    await ensureTutorStats(userId);
    welcome = await grantWelcomePoints(userId);
  }

  revalidatePath("/admin/users");
  return {
    ok: true,
    msg: `${email} 주소로 초대 메일을 보냈습니다.` + (welcome ? ` (환영 포인트 ${welcome}P 지급)` : ""),
  };
}

/** 기존 계정의 역할을 바꾼다. 대기 계정을 과외선생님으로 승인하면 환영 포인트를 한 번 준다. */
export async function changeRole(userId: string, role: Role) {
  const { userId: myId } = await requireRole("admin");
  if (userId === myId && role !== "admin") {
    return { ok: false, msg: "본인의 관리자 권한은 스스로 낮출 수 없습니다. 다른 관리자에게 부탁해 주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, msg: "권한을 바꾸지 못했습니다: " + error.message };

  let welcome = 0;
  if (role === "tutor") {
    await ensureTutorStats(userId);
    welcome = await grantWelcomePoints(userId);
  }

  revalidatePath("/admin/users");
  revalidatePath("/", "layout"); // 상단 메뉴의 "승인 대기" 숫자
  return { ok: true, welcome };
}

/**
 * #115: 과외선생님 계정 하나를 골라 포인트를 임의로 지급/차감한다(테스트 목적).
 * admin_adjust_tutor_points RPC는 is_admin()을 내부에서 직접 확인하므로, auth.uid()가 이 화면을 연
 * 관리자 본인으로 정확히 잡히도록 반드시 일반(세션 바인딩) 클라이언트로 호출해야 한다 —
 * createAdminClient()(서비스롤)로 호출하면 auth.uid()가 null이 돼서 RPC 내부의 is_admin() 검사가
 * 항상 실패한다.
 */
export async function adjustTutorPoints(tutorId: string, delta: number, note?: string) {
  await requireRole("admin");

  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("admin_adjust_tutor_points", {
    p_tutor_id: tutorId,
    p_delta: delta,
    p_note: note && note.trim() ? note.trim() : null,
  });

  if (error) return { ok: false, msg: "포인트를 조정하지 못했습니다: " + error.message };

  revalidatePath("/admin/users");
  return { ok: true, previousBalance: data?.previousBalance, newBalance: data?.newBalance };
}

/** 계정을 완전히 삭제해서 접근을 막는다(로그인 자체를 못 하게 됨). */
export async function revokeUser(userId: string) {
  const { userId: myId } = await requireRole("admin");
  if (userId === myId) {
    return { ok: false, msg: "본인 계정은 스스로 삭제할 수 없습니다." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, msg: "계정을 삭제하지 못했습니다: " + error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}
