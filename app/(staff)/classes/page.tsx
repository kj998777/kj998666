import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import AddClassForm from "./AddClassForm";
import ClassGroup from "./ClassGroup";
import Link from "next/link";

export default async function ClassesPage() {
  const session = await requireRole("viewer");
  const canEdit = session.role === "admin" || session.role === "editor";

  const supabase = await createClient();
  const { data: classes, error } = await supabase
    .from("classes")
    .select("id, level, grade, name")
    .order("level")
    .order("grade")
    .order("name");

  // 과외선생님 링크 제출(과외 반) 수 — 0029부터 모두 "과외" 반으로 모인다.
  const { count: tutorSubs } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .not("tutor_id", "is", null);

  const groups = new Map<string, { level: string; grade: number; items: { id: string; name: string }[] }>();
  for (const c of (classes ?? []) as any[]) {
    const key = `${c.level}${c.grade}`;
    if (!groups.has(key)) groups.set(key, { level: c.level, grade: c.grade, items: [] });
    groups.get(key)!.items.push({ id: c.id, name: c.name });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">반 관리</h1>
        <p className="text-sm text-slate-500">
          여기 등록한 반만 학생 제출 화면의 학교급→학년→반 버튼으로 나타납니다.
        </p>
      </div>

      {canEdit && (
        <div className="card max-w-lg">
          <h2 className="font-medium mb-3">반 일괄 추가</h2>
          <AddClassForm />
        </div>
      )}

      <Link href="/classes/tutor" className="card block hover:border-slate-400">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">과외 반</h2>
          <span className="badge bg-slate-100 text-slate-700">제출 {tutorSubs ?? 0}건</span>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          과외선생님 전용 QR·링크로 제출한 학생이 모두 모이는 반입니다(학생 제출 화면의 반 버튼에는 나오지 않음). 눌러서
          선생님별·시험별로 보고 관리하세요.
        </p>
      </Link>

      <div className="card">
        <h2 className="font-medium mb-3">등록된 반 ({classes?.length ?? 0}개)</h2>
        {error && <p className="text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>}
        {groups.size === 0 && <p className="text-sm text-slate-500">등록된 반이 없습니다.</p>}
        <div className="space-y-4">
          {Array.from(groups.values()).map((g) => (
            <ClassGroup key={`${g.level}${g.grade}`} level={g.level} grade={g.grade} items={g.items} canEdit={canEdit} />
          ))}
        </div>
      </div>
    </div>
  );
}
