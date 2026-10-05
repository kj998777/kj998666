import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createAdminClient } from "@/lib/supabase/admin";
import { encodeKey, autoKey } from "@/lib/students/analysis";
import { loadPickPage } from "@/lib/similar/load";
import SimilarPicker from "@/app/_components/SimilarPicker";

export const dynamic = "force-dynamic";

// 2026-10-05 오답 유사문제 고르기(과외선생님) — "내 학생" → 학생 → "유사문제 고르기". 본인 전용 링크로 들어온 제출만.
export default async function TutorSimilarPickPage({ params }: { params: { sid: string } }) {
  const session = await requireTutor();
  const admin = createAdminClient();
  const page = await loadPickPage(admin, params.sid);
  if (!page || page.tutorId !== session.userId) notFound();
  const back = `/tutor/students/${encodeKey(autoKey({ class_label: page.classLabel, student_name: page.studentName, tutor_id: page.tutorId } as any))}`;
  return <SimilarPicker page={page} backHref={back} backText={`${page.studentName} 학생`} />;
}
