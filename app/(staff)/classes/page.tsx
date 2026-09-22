import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import AddClassForm from "./AddClassForm";
import ClassGroup from "./ClassGroup";

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

  const groups = new Map<string, { level: string; grade: number; items: { id: string; name: string }[] }>();
  for (const c of classes ?? []) {
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
