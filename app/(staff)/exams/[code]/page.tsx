import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getJob } from "@/lib/ai/job";
import { getExamPdfMeta } from "@/lib/ai/pdf";
import AddAnswerKeyForm from "./AddAnswerKeyForm";
import AnswerKeyRow from "./AnswerKeyRow";
import ToggleStatusButton from "./ToggleStatusButton";
import DeleteExamButton from "./DeleteExamButton";
import AiJobPanel from "./AiJobPanel";
import UploadPdfForm from "./UploadPdfForm";
import AttachPdfForm from "./AttachPdfForm";
import ApproveReviewButton from "./ApproveReviewButton";
import ErrorCheckControl from "./ErrorCheckControl";
import { getItemCheck } from "@/lib/ai/errorcheck";
import DigitizeControl from "./DigitizeControl";
import { getDigitizeJob } from "@/lib/ai/digitize";
import SchoolLevelSelect from "./SchoolLevelSelect";
import FolderSelect from "./FolderSelect";

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

  const { data: keys } = await supabase
    .from("answer_key")
    .select("*")
    .eq("exam_id", exam.id)
    .order("sort_order")
    .order("item_label");

  const totalPoints = (keys ?? []).reduce((s: number, k: any) => s + Number(k.points), 0);
  const studentPath = `/s/${encodeURIComponent(exam.code)}`;

  const { data: explanations } = await supabase
    .from("item_explanations")
    .select("*")
    .eq("exam_id", exam.id)
    .order("item_label");

  let job = null as Awaited<ReturnType<typeof getJob>>;
  let pdfMeta: Awaited<ReturnType<typeof getExamPdfMeta>> = null;
  let notes: { id: string; note: string }[] = [];
  let corrections: { id: string; item_label: string; issue: string; fix: string }[] = [];
  const checksByLabel: Record<string, Awaited<ReturnType<typeof getItemCheck>>> = {};
  let digitizeJob: Awaited<ReturnType<typeof getDigitizeJob>> = null;
  if (canEdit) {
    pdfMeta = await getExamPdfMeta(supabase, exam.id);
  }
  if (isAdmin) {
    job = await getJob(supabase, exam.id);
    if (pdfMeta) digitizeJob = await getDigitizeJob(supabase, exam.id);
    if ((explanations ?? []).length > 0) {
      const { data: checks } = await supabase.from("item_checks").select("*").eq("exam_id", exam.id);
      for (const c of (checks as any[]) ?? []) checksByLabel[c.item_label] = { examId: c.exam_id, label: c.item_label, stage: c.stage, message: c.message, state: c.state, updatedAt: c.updated_at };
    }
    if (exam.status === "검수대기") {
      const [{ data: n }, { data: c }] = await Promise.all([
        supabase.from("exam_notes").select("id, note").eq("exam_id", exam.id).order("sort_order"),
        supabase.from("exam_corrections").select("id, item_label, issue, fix").eq("exam_id", exam.id).order("item_label"),
      ]);
      notes = (n as any) ?? [];
      corrections = (c as any) ?? [];
    }
  }
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {exam.name} <span className="text-slate-400 text-sm font-normal">({exam.code})</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            학생 제출 화면: <code className="bg-slate-100 px-1 rounded">{studentPath}</code>{" "}
            <Link href={`/exams/${encodeURIComponent(exam.code)}/results`} className="underline">
              채점 결과 보기
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {canEdit && <SchoolLevelSelect code={exam.code} level={exam.school_level ?? null} />}

      {canEdit && (
        <FolderSelect
          code={exam.code}
          year={exam.folder_year ?? null}
          grade={exam.folder_grade ?? null}
          term={exam.folder_term ?? null}
          kind={exam.folder_kind ?? null}
        />
      )}

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
          <AttachPdfForm code={exam.code} />
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
          <UploadPdfForm code={exam.code} />
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
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="exclude">뺄 쪽 번호(원본 기준, 쉼표로 구분)</label>
            <input id="exclude" name="exclude" type="text" placeholder="예: 8,9" className="input w-40" />
          </div>
          <button type="submit" className="btn-primary">
            PDF 다운로드
          </button>
        </form>
      )}

      {isAdmin && pdfMeta && (
        <DigitizeControl code={exam.code} examName={exam.name} initial={digitizePoll} isScanned={pdfMeta.is_scanned ?? null} />
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">정답 ({(keys ?? []).length}문항, 총 {totalPoints}점)</h2>
        </div>

        {(keys ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">아직 등록된 정답이 없습니다.</p>
        ) : (
          <table className="w-full text-sm mb-4">
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
        )}

        {canEdit && <AddAnswerKeyForm code={exam.code} nextSortOrder={(keys ?? []).length} />}
      </div>

      {(explanations ?? []).length > 0 && (
        <div className="card">
          <h2 className="font-medium mb-3">문항 해설 ({(explanations ?? []).length}문항, AI 자동 생성)</h2>
          <div className="space-y-2">
            {(explanations ?? []).map((e: any) => (
              <details key={e.id} className="border border-slate-200 rounded px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
                  <span>{e.item_label}번</span>
                  <span className="text-slate-400 font-normal">
                    {e.area && `${e.area} · `}
                    {e.difficulty}
                    {e.points_assigned && " · 배점임의"}
                  </span>
                  {e.exam_error_suspected && <span className="badge bg-red-100 text-red-700">⚠ 출제오류 의심</span>}
                </summary>
                <div className="mt-2 text-sm space-y-2 text-slate-700">
                  {e.exam_error_suspected && (
                    <div className="border border-red-200 bg-red-50 text-red-800 rounded px-3 py-2 text-sm space-y-1">
                      <p className="font-medium">⚠ 출제오류 의심{e.exam_error_kind ? ` — ${e.exam_error_kind}` : ""}</p>
                      {e.exam_error_reason && <p className="whitespace-pre-wrap">{e.exam_error_reason}</p>}
                      {e.exam_error_student_note && <p className="text-red-700">학생 안내: {e.exam_error_student_note}</p>}
                    </div>
                  )}
                  {e.unit && <p className="text-slate-500">단원: {e.unit}</p>}
                  {e.difficulty_reason && <p className="text-slate-500">난이도 판단: {e.difficulty_reason}</p>}
                  {e.problem_statement && <p className="whitespace-pre-wrap">{e.problem_statement}</p>}
                  {e.answer_display && (
                    <p>
                      <span className="font-medium">정답: </span>
                      {e.answer_display}
                    </p>
                  )}
                  {e.solution && (
                    <div>
                      <p className="font-medium">풀이</p>
                      <p className="whitespace-pre-wrap">{e.solution}</p>
                    </div>
                  )}
                  {isAdmin && (
                    <ErrorCheckControl
                      code={exam.code}
                      label={e.item_label}
                      suspected={e.exam_error_suspected}
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
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
