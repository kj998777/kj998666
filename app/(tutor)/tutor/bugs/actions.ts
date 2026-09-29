"use server";

import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUG_CATEGORIES, BUG_DAILY_LIMIT, BUG_PHOTO_BUCKET, isMissingTable } from "@/lib/bugs";

// 과외선생님 버그 신고 보내기(2026-09-29). bug_reports(0026)는 브라우저에서 직접 못 쓰는 표라
// 여기서 로그인(과외선생님)·입력값·하루 한도를 확인한 뒤 서비스롤로 저장한다.
// 서버 액션에서 throw한 문구는 운영 환경에서 화면에 보이지 않으므로 결과를 값으로 돌려준다.

type Result = { ok: true } | { ok: false; msg: string };
const PHOTO_MAX = 4 * 1024 * 1024; // 브라우저에서 줄여서 보냄(서버 요청 한도 약 4.5MB)

function str(v: FormDataEntryValue | null, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function submitBugReport(form: FormData): Promise<Result> {
  const session = await requireTutor();

  const category = str(form.get("category"), 30);
  const title = str(form.get("title"), 100);
  const body = str(form.get("body"), 4000);
  const pageHint = str(form.get("page_hint"), 300) || null;
  const userAgent = str(form.get("user_agent"), 400) || null;
  if (!(BUG_CATEGORIES as readonly string[]).includes(category)) return { ok: false, msg: "종류를 골라 주세요." };
  if (!title) return { ok: false, msg: "제목을 적어 주세요." };
  if (body.length < 5) return { ok: false, msg: "무슨 일이 있었는지 조금 더 자세히 적어 주세요." };

  const photo = form.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto) {
    if (!(photo as File).type.startsWith("image/")) return { ok: false, msg: "사진은 이미지 파일만 올릴 수 있습니다." };
    if ((photo as File).size > PHOTO_MAX) return { ok: false, msg: "사진 용량이 너무 큽니다(4MB 이하)." };
  }

  const admin = createAdminClient();

  // 하루 한도
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: cErr } = await (admin.from("bug_reports") as any)
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", session.userId)
    .gte("created_at", since);
  if (cErr) {
    return {
      ok: false,
      msg: isMissingTable(cErr)
        ? "버그 신고 기능이 아직 준비 중입니다(원장님이 설정을 마치면 쓸 수 있어요)."
        : "신고를 보내지 못했습니다: " + cErr.message,
    };
  }
  if ((count ?? 0) >= BUG_DAILY_LIMIT) {
    return { ok: false, msg: `하루에 ${BUG_DAILY_LIMIT}건까지 보낼 수 있습니다. 급한 일이면 원장님께 직접 연락해 주세요.` };
  }

  const { data: row, error } = await (admin.from("bug_reports") as any)
    .insert({ reporter_id: session.userId, category, title, body, page_hint: pageHint, user_agent: userAgent })
    .select("id")
    .single();
  if (error || !row) return { ok: false, msg: "신고를 보내지 못했습니다: " + (error?.message ?? "알 수 없는 오류") };

  if (hasPhoto) {
    const file = photo as File;
    const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `bugs/${row.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUG_PHOTO_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (!upErr) {
      await (admin.from("bug_reports") as any).update({ photo_path: path }).eq("id", row.id);
    }
    // 사진 저장이 실패해도 신고 내용은 이미 접수됐으므로 성공으로 본다.
  }

  revalidatePath("/tutor/bugs");
  revalidatePath("/admin/bug-reports");
  return { ok: true };
}
