import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadUnclassified } from "@/lib/similar/unclassified";
import { LOGIC_SUBJECTS, LOGIC_TYPES } from "@/lib/similar/logicTypes";
import LogicTypesClient from "./LogicTypesClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 2026-10-05 원장님 "AI로 올리는 문제들 중에는 유형처리가 안 되는 것들도 있단 말이지? 그런 문제들 모아서 한번에 유형
// 처리할 수 있게끔 탭". 논리 유형(item_explanations.logic_type)이 빈 문항을 시험별로 모아 보여 주고, 시험마다(또는 전부)
// AI로 분류하거나 문항 하나씩 직접 고른다. 유형이 있어야 오답 유사문제 후보가 된다.
export default async function LogicTypesPage() {
  await requireRole("admin");
  const exams = await loadUnclassified(createAdminClient());
  const types = Object.values(LOGIC_TYPES).map((t) => ({ key: t.key, subject: t.subject, label: `${t.group} · ${t.name}` }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">유형 분류</h1>
        <p className="text-sm text-slate-600 mt-1">
          논리 유형이 정해지지 않은 문항을 모았습니다. 유형이 있어야 <b>오답 유사문제</b> 후보로 쓰입니다. 새로 올리는 시험은 AI가 풀 때 유형도 함께
          정하지만, 과목을 알아보지 못했거나 AI가 빠뜨린 문항은 여기에 남습니다.
        </p>
      </div>
      <LogicTypesClient exams={exams} subjects={LOGIC_SUBJECTS} types={types} />
    </div>
  );
}
