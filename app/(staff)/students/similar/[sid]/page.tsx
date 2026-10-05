import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { encodeKey, autoKey } from "@/lib/students/analysis";
import { loadPickPage } from "@/lib/similar/load";
import SimilarPicker from "@/app/_components/SimilarPicker";

export const dynamic = "force-dynamic";

// 2026-10-05 오답 유사문제 고르기(원장님·편집자) — 학생 화면 "낸 시험"의 "유사문제 고르기"에서 들어온다.
export default async function StaffSimilarPickPage({ params }: { params: { sid: string } }) {
  await requireRole("editor");
  const admin = createAdminClient();
  const page = await loadPickPage(admin, params.sid);
  if (!page) notFound();
  const back = `/students/${encodeKey(autoKey({ class_label: page.classLabel, student_name: page.studentName, tutor_id: page.tutorId } as any))}?tab=subs`;
  return <SimilarPicker page={page} backHref={back} backText={`${page.studentName} 학생`} />;
}
