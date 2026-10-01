import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { getPurchasedExam } from "@/lib/tutor/purchased";
import { ensureTutorLinkToken, tutorSubmitPath } from "@/lib/tutor/link";
import TutorExamTabs from "./TutorExamTabs";
import CopyLink from "./results/CopyLink";
import ContentKindBadge from "../ContentKindBadge";
import { MEDIC_USE_NOTE } from "@/lib/content/kinds";

export const dynamic = "force-dynamic";

// #4: 구매한 시험 관리 — 첫 탭(기출문제 다운로드). 스토어·구매 내역의 "관리하기" 버튼이 여기로 온다.
export default async function TutorExamHubPage({ params }: { params: { code: string } }) {
  const session = await requireTutor();
  const code = decodeURIComponent(params.code);
  const exam = await getPurchasedExam(session.userId, code);
  if (!exam) notFound();

  let submitPath: string | null = null;
  try {
    submitPath = tutorSubmitPath(exam.code, await ensureTutorLinkToken(session.userId));
  } catch {
    submitPath = null;
  }
  const base = `/tutor/store/${encodeURIComponent(exam.code)}`;

  return (
    <div className="space-y-4">
      <TutorExamTabs code={exam.code} name={exam.name} active="download" />

      {/* 2026-10-01: 학교 기출 원본과 메딕 해설(원장님·검토단이 만든 것)을 나눠 보여 준다 — lib/content/kinds.ts */}
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContentKindBadge kind="original" />
          <h2 className="font-medium">기출문제 PDF</h2>
        </div>
        <p className="text-sm text-slate-500">
          원본 뒤에 붙어 있던 정답·해설·마킹 쪽은 빼고 문제만 남긴 뒤, 앞에는 메딕수학 표지가, 맨 뒤에는 메딕수학
          로고와 <strong>선생님 전용 답안 제출 QR</strong>이 붙습니다. 학생이 이 QR로 답을 내면 &ldquo;제출 학생·보고서&rdquo; 탭에서 결과를 보고 보고서를 만들 수
          있습니다. 시험지 오류 정정(정오표)이 있으면 QR 쪽 앞에 함께 들어갑니다.
        </p>
        <a href={`${base}/download`} className="btn-primary inline-block">
          PDF 받기
        </a>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContentKindBadge kind="medic" />
          <h2 className="font-medium">정답·해설과 성적 보고서</h2>
        </div>
        <p className="text-sm text-slate-500">
          빠른 정답표·문항별 풀이를 모은 <strong>전체 문제 해설지</strong>와 학생 <strong>성적 보고서</strong>는 원장님과 검토단이 만든{" "}
          <strong>메딕 해설</strong>입니다. &ldquo;제출 학생·보고서&rdquo; 탭에서 PDF로 받을 수 있고, 제출한 학생이 없어도 해설지는 받을 수 있습니다.
        </p>
        <p className="text-xs text-slate-500">{MEDIC_USE_NOTE}</p>
        <a href={`${base}/results`} className="btn-secondary inline-block">
          해설지·보고서 받으러 가기 →
        </a>
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">선생님 전용 제출 링크</h2>
        {submitPath ? (
          <>
            <p className="text-sm text-slate-500">
              QR 대신 링크로 나눠줄 때 쓰세요. 이 링크로 제출한 학생만 선생님 화면에 보입니다(학원 학생 제출은 보이지 않음).
            </p>
            <CopyLink path={submitPath} />
          </>
        ) : (
          <p className="text-sm text-red-600">제출 링크를 준비하지 못했습니다. 잠시 후 다시 열어 주세요.</p>
        )}
      </div>
    </div>
  );
}
