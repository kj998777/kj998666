import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import CreateExamForm from "./CreateExamForm";

export default async function ExamsPage() {
  const session = await requireRole("viewer");
  const canEdit = session.role === "admin" || session.role === "editor";

  const supabase = await createClient();
  const { data: exams, error } = await supabase
    .from("exams")
    .select("id, code, name, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">시험·정답 관리</h1>
        <p className="text-sm text-slate-500">시험을 만들고 정답을 등록하면, 관리자가 열어야 학생이 제출할 수 있습니다.</p>
      </div>

      {canEdit && (
        <div className="card max-w-md">
          <h2 className="font-medium mb-3">새 시험 만들기</h2>
          <CreateExamForm />
        </div>
      )}

      <div className="card">
        <h2 className="font-medium mb-3">전체 시험 ({exams?.length ?? 0}개)</h2>
        {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        {(exams ?? []).length === 0 && <p className="text-sm text-slate-500">아직 만든 시험이 없습니다.</p>}
        <ul className="divide-y divide-slate-100">
          {(exams ?? []).map((x: any) => (
            <li key={x.id} className="py-3 flex items-center justify-between">
              <Link href={`/exams/${encodeURIComponent(x.code)}`} className="hover:underline">
                <span className="font-medium">{x.name}</span>{" "}
                <span className="text-slate-400 text-sm">({x.code})</span>
              </Link>
              <span
                className={
                  "badge " + (x.status === "열림" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")
                }
              >
                {x.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
