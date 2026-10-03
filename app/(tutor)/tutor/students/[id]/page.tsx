import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { decodeKey } from "@/lib/students/analysis";
import { loadTutorStudent } from "@/lib/tutor/students";
import SubmittedExams, { type ExamLinks } from "@/app/_components/SubmittedExams";

export const dynamic = "force-dynamic";

// 2026-10-03 "내 학생" → 학생 한 명: 낸 시험(다시 낸 것 포함) 최신순, 시험마다 문항별 답안·풀이·개별 보고서 PDF.
// 주소의 학생 키는 "과외:<본인 id>|이름"만 받는다(lib/tutor/students.ts loadTutorStudent).
export default async function TutorStudentPage({ params }: { params: { id: string } }) {
  const session = await requireTutor();
  const key = decodeKey(params.id);
  if (!key) notFound();
  const d = await loadTutorStudent(session.userId, key);
  if (!d) notFound();

  const links: ExamLinks = {};
  for (const e of d.submitted) {
    const own = d.purchasedCodes.has(e.code);
    links[e.code] = {
      href: own ? `/tutor/store/${encodeURIComponent(e.code)}/results` : null,
      reportUrl: own ? `/tutor/store/${encodeURIComponent(e.code)}/report-data` : null,
    };
  }
  const rates = d.submitted.map((e) => e.rate).filter((x): x is number => x != null);
  const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : null;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/tutor/students" className="text-sm link-accent">
          ← 내 학생
        </Link>
        <h1 className="text-xl font-semibold mt-1">{d.name}</h1>
        <p className="text-sm text-slate-500">
          낸 시험 {d.submitted.length}개{avg != null ? ` · 평균 득점률 ${avg}%` : ""}
        </p>
      </div>
      <SubmittedExams exams={d.submitted} links={links} />
    </div>
  );
}
