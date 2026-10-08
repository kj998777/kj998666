import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getJob } from "@/lib/ai/job";
import { getExamPdfMeta, hasScanPdf } from "@/lib/ai/pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import AddAnswerKeyForm from "./AddAnswerKeyForm";
import AnswerKeyRow from "./AnswerKeyRow";
import ToggleStatusButton from "./ToggleStatusButton";
import DeleteExamButton from "./DeleteExamButton";
import AiJobPanel from "./AiJobPanel";
import UploadPdfForm from "./UploadPdfForm";
import AttachPdfForm from "./AttachPdfForm";
import ApproveReviewButton from "./ApproveReviewButton";
import { getItemCheck } from "@/lib/ai/errorcheck";
import DigitizeControl from "./DigitizeControl";
import { getDigitizeJob } from "@/lib/ai/digitize";
import SchoolLevelSelect from "./SchoolLevelSelect";
import JejuToggle from "./JejuToggle";
import FolderSelect from "./FolderSelect";
import CollectionInput from "./CollectionInput";
import ItemExplanationRow from "./ItemExplanationRow";
import TutorDownloadCostInput from "./TutorDownloadCostInput";
import { pageRangeLabel, trailingAnswerPages } from "@/lib/ai/answerPages";
import { getQrBoxes } from "@/lib/ai/qrMask";
import QrScanButton from "./QrScanButton";

const ACTIVE_STAGES = new Set(["upload", "extract_submit", "extract_wait", "solve_submit", "solve_wait"]);

export default async function ExamDetailPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams?: { aiErr?: string };
}) {
  const session = await requireRole("viewer");
  const canEdit = session.role === "admin" || session.role === "editor";
  const isAdmin = session.role === "admin";
  const code = decodeURIComponent(params.code);

  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("*").eq("code", code).single()) as any;
  if (!exam) notFound();

  // 2026-10-08 최적화: 시험 정보 다음의 조회들은 서로 기다릴 필요가 없어 한꺼번에 보낸다(예전엔 하나씩 차례로 ~8번 왕복).
  const wantReview = isAdmin && exam.status === "검수대기";
  const [
    { data: keys },
    { data: explanations },
    pdfMetaAndQr,
    job,
    { data: checks },
    { data: noteRows },
    { data: correctionRows },
  ] = await Promise.all([
    supabase.from("answer_key").select("*").eq("exam_id", exam.id).order("sort_order").order("item_label"),
    supabase.from("item_explanations").select("*").eq("exam_id", exam.id).order("item_label"),
    canEdit ? Promise.all([getExamPdfMeta(supabase, exam.id), getQrBoxes(supabase, exam.id)]) : Promise.resolve(null),
    isAdmin ? getJob(supabase, exam.id) : Promise.resolve(null),
    isAdmin ? supabase.from("item_checks").select("*").eq("exam_id", exam.id) : Promise.resolve({ data: null }),
    wantReview
      ? supabase.from("exam_notes").select("id, note").eq("exam_id", exam.id).order("sort_order")
      : Promise.resolve({ data: null }),
    wantReview
      ? supabase.from("exam_corrections").select("id, item_label, issue, fix").eq("exam_id", exam.id).order("item_label")
      : Promise.resolve({ data: null }),
  ]);

  const totalPoints = (keys ?? []).reduce((s: number, k: any) => s + Number(k.points), 0);
  // 2026-10-03: 문항 해설 줄에서 정답 표시가 정답표와 다른지 보여 주기 위해 번호별 정답표 칸을 넘긴다.
  const keyByLabel: Record<string, { type: string; correct_answers: string }> = {};
  for (const k of (keys as any[]) ?? []) keyByLabel[k.item_label] = { type: k.type, correct_answers: String(k.correct_answers ?? "") };
  const studentPath = `/s/${encodeURIComponent(exam.code)}`;

  const pdfMeta: Awaited<ReturnType<typeof getExamPdfMeta>> = pdfMetaAndQr ? pdfMetaAndQr[0] : null;
  // 원본 속 QR 가리기(0031): 찾아 둔 위치·진행 상태
  const qr: Awaited<ReturnType<typeof getQrBoxes>> = pdfMetaAndQr ? pdfMetaAndQr[1] : { status: "unavailable", boxes: [], message: "" };
  const notes: { id: string; note: string }[] = (noteRows as any) ?? [];
  const corrections: { id: string; item_label: string; issue: string; fix: string }[] = (correctionRows as any) ?? [];
  const checksByLabel: Record<string, Awaited<ReturnType<typeof getItemCheck>>> = {};
  for (const c of (checks as any[]) ?? []) checksByLabel[c.item_label] = { examId: c.exam_id, label: c.item_label, stage: c.stage, message: c.message, state: c.state, updatedAt: c.updated_at };
  const qrPages = Array.from(new Set(qr.boxes.map((b) => b.page))).sort((a, b) => a - b);
  const jobPoll = job
    ? {
        stage: job.stage,
        message: job.message,
        updatedAt: job.updatedAt,
        progress:
          Array.isArray(job.state?.qs) && job.state.qs.length > 0
            ? { done: job.state?.done ?? 0, total: job.state.qs.length }
            : null,
      }
    : null;

  // #7: 원본 PDF 뒤쪽의 정답·해설·OMR 쪽(마지막 문항 쪽 뒤). 디지털화 결과로 바꾼 PDF는 이미 문제 쪽만 있음.
  const answerPages: number[] =
    pdfMeta && !pdfMeta.replaced_with_digitized && typeof pdfMeta.pages === "number"
      ? trailingAnswerPages(((explanations as any[]) ?? []).map((e) => e.source_page), pdfMeta.pages)
      : [];

  // 2026-09-29: 원본으로 적용하면서 스캔본이 지워진 예전 시험인지(그림 다시 오리기·그림 자리 고치기에 스캔본이 필요)
  // 원본 PDF 정보가 있어야 알 수 있는 두 가지는 그다음에 한꺼번에 묻는다.
  const [digitizeJob, scanMissing] = await Promise.all([
    isAdmin && pdfMeta ? getDigitizeJob(supabase, exam.id) : Promise.resolve(null),
    isAdmin && pdfMeta?.replaced_with_digitized
      ? hasScanPdf(createAdminClient(), exam.id).then(
          (has) => !has,
          () => false
        )
      : Promise.resolve(false),
  ]);
  const digitizePoll = digitizeJob
    ? {
        stage: digitizeJob.stage,
        message: digitizeJob.message,
        updatedAt: digitizeJob.updatedAt,
        progress:
          typeof digitizeJob.state?.totalPages === "number" && digitizeJob.state.totalPages > 0
            ? { done: digitizeJob.state?.done ?? 0, total: digitizeJob.state.totalPages }
            : null,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">
            {exam.name} <span className="text-slate-400 text-sm font-normal whitespace-nowrap">({exam.code})</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            학생 제출 화면: <code className="bg-slate-100 px-1 rounded break-all">{studentPath}</code>{" "}
            <Link href={`/exams/${encodeURIComponent(exam.code)}/results`} className="underline">
              채점 결과 보기
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "badge " +
              (exam.status === "열림"
                ? "bg-emerald-100 text-emerald-700"
                : exam.status === "검수대기"
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-600")
            }
          >
            {exam.status}
          </span>
          {session.role === "admin" && exam.status !== "검수대기" && (
            <ToggleStatusButton code={exam.code} open={exam.status === "열림"} hasKey={(keys ?? []).length > 0} />
          )}
          {session.role === "admin" && <DeleteExamButton examId={exam.id} />}
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-4">
          <SchoolLevelSelect code={exam.code} level={exam.school_level ?? null} />
          <JejuToggle code={exam.code} jeju={!!exam.is_jeju} />
        </div>
      )}

      {canEdit && (
        <FolderSelect
          code={exam.code}
          year={exam.folder_year ?? null}
          grade={exam.folder_grade ?? null}
          term={exam.folder_term ?? null}
          kind={exam.folder_kind ?? null}
        />
      )}

      {canEdit && <CollectionInput code={exam.code} value={exam.collection ?? null} />}

      {session.role !== "admin" && exam.status === "검수대기" && (
        <div className="card border-amber-300 bg-amber-50 text-amber-800 text-sm">
          AI가 이 시험을 자동 처리했습니다. 관리자가 정답을 확인하고 열어야 학생이 제출할 수 있습니다.
        </div>
      )}
      {session.role !== "admin" && exam.status === "닫힘" && (
        <div className="card border-amber-300 bg-amber-50 text-amber-800 text-sm">
          시험 열기/닫기는 관리자만 할 수 있습니다. 정답을 다 등록했으면 관리자에게 열어 달라고 요청해 주세요.
        </div>
      )}

      {isAdmin && searchParams?.aiErr && (
        <div className="card border-red-300 bg-red-50 text-red-700 text-sm">
          AI 자동 처리를 시작하지 못했습니다: {searchParams.aiErr} — 아래에서 PDF를 다시 올려 시도해 주세요.
        </div>
      )}

      {isAdmin && jobPoll && jobPoll.stage !== "done" && <AiJobPanel code={exam.code} initial={jobPoll} />}

      {isAdmin && exam.status === "검수대기" && (
        <div className="card border-amber-300 bg-amber-50 space-y-3">
          <h2 className="font-medium text-amber-900">AI 검수 대기</h2>
          <p className="text-sm text-amber-800">
            AI가 만든 정답·해설입니다. 아래 정답표를 확인·수정한 뒤 확정하면 시험이 열립니다.
          </p>
          {(explanations ?? []).length > 0 && (
            <p className="text-sm text-amber-800">
              {/* #3: 문항별 정답이 모두 확정되면(과외선생님 답이 정답표와 일치하면 자동, 아니면 관리자가
                  검토현황에서 확정) 자동으로 시험이 열리고 스토어에 등록됩니다. */}
              정답 확정 {(explanations as any[]).filter((e) => e.review_confirmed).length} /{" "}
              {(explanations as any[]).length}문항 · 과외선생님 제출{" "}
              {(explanations as any[]).filter((e) => e.tutor_reviewed).length}문항 —{" "}
              <Link href="/admin/review-status" className="underline">
                검토현황에서 문항별로 확정하기
              </Link>
            </p>
          )}
          {notes.length > 0 && (
            <ul className="text-sm text-amber-800 list-disc list-inside space-y-0.5">
              {notes.map((n) => (
                <li key={n.id}>{n.note}</li>
              ))}
            </ul>
          )}
          {corrections.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-amber-900 mb-1">시험지 오류 정정(정오표)</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-800">
                {corrections.map((c) => (
                  <li key={c.id}>
                    {c.item_label}번 — {c.issue} → {c.fix}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ApproveReviewButton code={exam.code} />
        </div>
      )}

      {canEdit && !pdfMeta && (
        <div className="card border-sky-200 space-y-2">
          <h2 className="font-medium">원본 PDF 첨부 (AI 처리 없이 저장만)</h2>
          <p className="text-sm text-slate-500">
            이 시험은 아직 원본 시험지 PDF가 저장돼 있지 않아 QR·정오표 PDF를 다운로드할 수 없습니다
            (예: 예전 시스템에서 옮겨온 시험). 이미 정답·해설이 있는 시험이면 이 폼으로 원본 PDF 파일만
            연결하세요 — AI가 다시 처리하지 않고 그대로 저장만 합니다.
          </p>
          <AttachPdfForm code={exam.code} examId={exam.id} />
        </div>
      )}

      {isAdmin && (!jobPoll || !ACTIVE_STAGES.has(jobPoll.stage)) && exam.status !== "검수대기" && (
        <div className="card">
          <h2 className="font-medium mb-2">AI 자동 처리</h2>
          <p className="text-sm text-slate-500 mb-2">
            {pdfMeta
              ? "이미 저장된 시험지 PDF가 있습니다. 새 PDF를 올리면 그 파일로 다시 처리합니다."
              : "시험지 PDF를 올리면 AI가 정답·해설을 자동으로 만듭니다."}
          </p>
          <UploadPdfForm code={exam.code} examId={exam.id} />
        </div>
      )}

      {canEdit && pdfMeta && (
        <form
          action={`/exams/${encodeURIComponent(exam.code)}/pdf`}
          method="get"
          target="_blank"
          className="card space-y-2"
        >
          <h2 className="font-medium">시험지 PDF 다운로드 (QR·정오표 포함)</h2>
          <p className="text-sm text-slate-500">
            학생에게 나눠 줄 시험지 PDF를 만듭니다. 맨 뒤에 제출 QR 쪽이 자동으로 붙습니다.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="cover" value="1" defaultChecked /> 표지 넣기 (표지 + 백지 1쪽)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="addFix" value="1" defaultChecked /> 정정 사항을 정정 페이지로 추가
            </label>
            {/* #7: 마지막 문항 쪽 뒤의 정답·해설·OMR 쪽 자동 제외 */}
            {answerPages.length > 0 && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="autoTrim" value="1" defaultChecked /> 뒤쪽 정답·해설 쪽 빼기 (원본{" "}
                {pageRangeLabel(answerPages)})
              </label>
            )}
            {/* 2026-09-29: 원본 쪽 안에 인쇄된 QR(학교·다른 학원 등)을 흰 칸으로 가림 */}
            {qr.status === "done" && qr.boxes.length > 0 && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="maskQr" value="1" defaultChecked /> 원본 속 QR 가리기 ({qr.boxes.length}개 ·{" "}
                {qrPages.join(", ")}쪽)
              </label>
            )}
          </div>
          {qr.status !== "unavailable" && (
            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
              <span>
                {qr.status === "done"
                  ? qr.boxes.length
                    ? "원본에 인쇄된 QR을 AI가 찾아 두었습니다. 체크하면 흰 칸으로 가립니다(원본 파일은 그대로)."
                    : "원본에서 QR을 찾지 못했습니다(가릴 것 없음)."
                  : qr.status === "pending"
                    ? "원본 속 QR을 AI가 찾는 중입니다(보통 몇 분). 끝나면 여기서 가리기를 고를 수 있습니다."
                    : qr.status === "error"
                      ? `원본 속 QR을 찾지 못했습니다: ${qr.message}`
                      : "원본 속 QR을 아직 찾지 않았습니다."}
              </span>
              {isAdmin && qr.status !== "pending" && (
                <QrScanButton code={exam.code} label={qr.status === "done" ? "QR 다시 찾기" : "QR 찾기"} />
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="exclude">뺄 쪽 번호(원본 기준, 쉼표로 구분)</label>
            <input id="exclude" name="exclude" type="text" placeholder="예: 8,9" className="input w-40" />
          </div>
          <button type="submit" className="btn-primary">
            PDF 다운로드
          </button>
        </form>
      )}

      {isAdmin && pdfMeta && (
        <DigitizeControl
          code={exam.code}
          examId={exam.id}
          examName={exam.name}
          initial={digitizePoll}
          isScanned={pdfMeta.is_scanned ?? null}
          appliedAsOriginal={pdfMeta.replaced_with_digitized ?? false}
          scanMissing={scanMissing}
        />
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
          <h2 className="font-medium">정답 ({(keys ?? []).length}문항, 총 {totalPoints}점)</h2>
        </div>

        {(keys ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">아직 등록된 정답이 없습니다.</p>
        ) : (
          <div className="table-wrap mb-4">
          <table className="w-full min-w-[34rem] sm:min-w-0 text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">번호</th>
                <th className="py-1 pr-2">유형</th>
                <th className="py-1 pr-2">정답 (여러 개는 | 로 구분)</th>
                <th className="py-1 pr-2">배점</th>
                <th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {(keys ?? []).map((k: any) => (
                <AnswerKeyRow key={k.id} code={exam.code} row={k} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
          </div>
        )}

        {canEdit && <AddAnswerKeyForm code={exam.code} nextSortOrder={(keys ?? []).length} />}
      </div>

      {canEdit && exam.status === "열림" && (
        <TutorDownloadCostInput code={exam.code} cost={exam.tutor_download_cost ?? null} />
      )}

      {(explanations ?? []).length > 0 && (
        <div className="card">
          <h2 className="font-medium mb-3">
            문항 해설 ({(explanations ?? []).length}문항, AI 자동 생성{canEdit ? " · 직접 수정 가능" : ""})
          </h2>
          <div className="space-y-2">
            {(explanations ?? []).map((e: any) => (
              <ItemExplanationRow
                key={e.id}
                code={exam.code}
                row={e}
                canEdit={canEdit}
                isAdmin={isAdmin}
                keyInfo={keyByLabel[e.item_label] ?? null}
                initialCheck={
                  checksByLabel[e.item_label]
                    ? {
                        stage: checksByLabel[e.item_label]!.stage,
                        message: checksByLabel[e.item_label]!.message,
                        updatedAt: checksByLabel[e.item_label]!.updatedAt,
                      }
                    : null
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
