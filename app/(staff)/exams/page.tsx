import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import CreateExamForm from "./CreateExamForm";
import CreateAiExamForm from "./CreateAiExamForm";
import CreateAiExamBatchForm from "./CreateAiExamBatchForm";
import ExamFolderTree from "./ExamFolderTree";

const LEVEL_LABEL: Record<string, string> = { 초: "초등학교", 중: "중학교", 고: "고등학교" };

export default async function ExamsPage({ searchParams }: { searchParams?: { level?: string } }) {
  const session = await requireRole("viewer");
  const canEdit = session.role === "admin" || session.role === "editor";
  const isAdmin = session.role === "admin";
  const levelFilter = searchParams?.level && searchParams.level in LEVEL_LABEL ? searchParams.level : null;

  const supabase = await createClient();
  let query = supabase
    .from("exams")
    .select("id, code, name, status, school_level, created_at, folder_year, folder_grade, folder_term, folder_kind")
    .order("created_at", { ascending: false });
  if (levelFilter) query = query.eq("school_level", levelFilter);
  const { data: exams, error } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">시험·정답 관리</h1>
        <p className="text-sm text-slate-500">시험을 만들고 정답을 등록하면, 관리자가 열어야 학생이 제출할 수 있습니다.</p>
      </div>

      {(canEdit || isAdmin) && (
        <div className="grid gap-4 md:grid-cols-2">
          {canEdit && (
            <div className="card">
              <h2 className="font-medium mb-3">새 시험 만들기 (직접 입력)</h2>
              <CreateExamForm />
            </div>
          )}
          {isAdmin && (
            <div className="card border-sky-200">
              <h2 className="font-medium mb-3">새 시험 올리기 (AI 자동 처리)</h2>
              <CreateAiExamForm />
            </div>
          )}
        </div>
      )}

      {isAdmin && (
      <div className="card border-sky-200">
      
      <h2 className="font-medium mb-3">여러 시험 한꺼번에 올리기 (AI 자동 처리)</h2>
      <CreateAiExamBatchForm /></div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-medium">전체 시험 ({exams?.length ?? 0}개)</h2>
          <div className="flex gap-1 text-sm">
            <Link href="/exams" className={"badge " + (!levelFilter ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}>
              전체
            </Link>
            {Object.entries(LEVEL_LABEL).map(([k, label]) => (
              <Link
                key={k}
                href={`/exams?level=${k}`}
                className={"badge " + (levelFilter === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        <ExamFolderTree exams={(exams ?? []) as any} />
      </div>
    </div>
  );
}
