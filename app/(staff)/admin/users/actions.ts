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

/** 2026-09-29: 대기 화면에 띄울 원장님 카카오톡 연락처 저장(0033 site_contact, 관리자만). */
export async function saveKakaoContact(input: { kakao_id: string; kakao_url: string; kakao_qr: string; note: string }) {
  await requireRole("admin");
  const kakao_id = String(input?.kakao_id ?? "").trim().slice(0, 60);
  let kakao_url = String(input?.kakao_url ?? "").trim();
  const kakao_qr = String(input?.kakao_qr ?? "");
  const note = String(input?.note ?? "").trim().slice(0, 300);
  if (kakao_url && !/^https?:\/\//i.test(kakao_url)) kakao_url = "https://" + kakao_url;
  if (kakao_url.length > 300) return { ok: false, msg: "링크가 너무 깁니다." };
  if (kakao_qr && !/^data:image\/(png|jpeg|webp);base64,/.test(kakao_qr)) return { ok: false, msg: "QR 그림 형식이 올바르지 않습니다." };
  if (kakao_qr.length > 400000) return { ok: false, msg: "QR 그림이 너무 큽니다. 화면 캡처를 잘라서 다시 올려 주세요." };
  const supabase = await createClient();
  const { error } = await (supabase.from("site_contact") as any)
    .update({ kakao_id: kakao_id || null, kakao_url: kakao_url || null, kakao_qr: kakao_qr || null, note: note || null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath("/admin/users");
  revalidatePath("/pending");
  return { ok: true };
}

// ── 2026-09-29 학번(학생증 번호) — 0036 student_numbers. 관리자만 읽고 쓴다(평소 화면에는 절대 안 나옴). ──

type StudentNoResult = { ok: true; welcome?: number } | { ok: false; msg: string };

function studentNoError(r: any, error?: any): string {
  if (error) {
    const m = String(error.message || error);
    if (/admin_approve_with_student_no|admin_set_student_no|student_numbers/.test(m) && /does not exist|not find|schema cache/i.test(m)) {
      return "학번 저장 기능이 아직 DB에 없습니다. 0036 SQL을 먼저 실행해 주세요.";
    }
    return "처리하지 못했습니다: " + m;
  }
  switch (r?.reason) {
    case "duplicate": {
      const who = [r.other_department, r.other_cohort, r.other_name].filter(Boolean).join(" ");
      return `이 학번은 이미 다른 계정(${who ? who + " · " : ""}${r.other_email ?? "알 수 없음"})에 등록돼 있어 승인할 수 없습니다.`;
    }
    case "format":
      return "학번 형식이 올바르지 않습니다(숫자·영문 4~20자, 예: 2025114055).";
    case "empty":
      return "학번을 붙여 넣어 주세요.";
    case "no_user":
      return "계정을 찾지 못했습니다.";
    case "forbidden":
      return "관리자만 할 수 있습니다.";
    default:
      return "처리하지 못했습니다.";
  }
}

/** 대기 계정: 학번을 저장하면서 권한을 준다(한 번에 — 학번이 다른 계정에 있으면 둘 다 안 됨). */
export async function approveWithStudentNo(userId: string, studentNo: string, role: Role): Promise<StudentNoResult> {
  await requireRole("admin");
  if (!isRole(role)) return { ok: false, msg: "역할 값이 올바르지 않습니다." };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("admin_approve_with_student_no", {
    p_user_id: userId,
    p_student_no: String(studentNo ?? "").slice(0, 60),
    p_role: role,
  });
  if (error || !data?.ok) return { ok: false, msg: studentNoError(data, error) };

  let welcome = 0;
  if (role === "tutor") {
    await ensureTutorStats(userId);
    welcome = await grantWelcomePoints(userId);
  }
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return { ok: true, welcome };
}

/** 이미 승인된 계정에 학번을 넣거나 고친다(빈 값이면 지움). */
export async function setStudentNo(userId: string, studentNo: string): Promise<StudentNoResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as any)("admin_set_student_no", {
    p_user_id: userId,
    p_student_no: String(studentNo ?? "").slice(0, 60),
  });
  if (error || !data?.ok) return { ok: false, msg: studentNoError(data, error) };
  revalidatePath("/admin/users");
  return { ok: true };
}

/** "보기"를 눌렀을 때만 학번 하나를 읽어 온다(페이지 HTML에는 학번이 들어가지 않게). */
export async function revealStudentNo(userId: string): Promise<{ ok: true; studentNo: string | null } | { ok: false; msg: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await (supabase.from("student_numbers") as any).select("student_no").eq("user_id", userId).maybeSingle();
  if (error) return { ok: false, msg: studentNoError(null, error) };
  return { ok: true, studentNo: data?.student_no ?? null };
}
