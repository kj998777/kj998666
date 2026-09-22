"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/supabase/types";

function isRole(v: unknown): v is Role {
  return v === "admin" || v === "editor" || v === "viewer";
}

/** 새 계정 초대: 이메일로 로그인 링크가 담긴 초대 메일을 보내고, 원하는 역할을 함께 지정한다. */
export async function inviteUser(formData: FormData) {
  await requireRole("admin"); // 이중 방어: 이 화면은 admin만 보이지만, 액션 자체도 다시 검사

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  if (!email) return { ok: false, msg: "이메일을 입력해 주세요." };
  if (!isRole(role)) return { ok: false, msg: "역할 값이 올바르지 않습니다." };

  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role }, // handle_new_user() 트리거가 이 값을 읽어 profiles.role 초기값으로 씀
    redirectTo: `${siteUrl}/auth/callback`,
  });

  if (error) return { ok: false, msg: "초대 메일을 보내지 못했습니다: " + error.message };

  revalidatePath("/admin/users");
  return { ok: true, msg: `${email} 주소로 초대 메일을 보냈습니다.` };
}

/** 기존 계정의 역할을 바꾼다. */
export async function changeRole(userId: string, role: Role) {
  const { userId: myId } = await requireRole("admin");
  if (userId === myId && role !== "admin") {
    return { ok: false, msg: "본인의 관리자 권한은 스스로 낮출 수 없습니다. 다른 관리자에게 부탁해 주세요." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, msg: "권한을 바꾸지 못했습니다: " + error.message };

  revalidatePath("/admin/users");
  return { ok: true };
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
