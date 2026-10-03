import "server-only";
import { applyRegradePlan, regradePlan } from "@/lib/review/regrade";
import { fetchAllPages } from "@/lib/supabase/fetchAll";

// 전체 재채점(2026-10-03 원장님 요청 "재채점도 해줘") — 채점 결과가 있는 모든 시험을 지금 정답표로 다시 매긴다.
// 정답표를 고쳐도 기존 채점이 그대로이던 시절(PR #57 전)의 결과를 한 번에 바로잡는 용도. 운영 현황의
// 버튼에서 "미리보기(apply=false)" → "실행(apply=true)" 두 단계로 쓴다. 여러 번 눌러도 안전하다(같은 정답표면 바뀌는 게 없음).

type Client = any;

export type RegradeExamReport = {
  examId: string;
  code: string;
  name: string;
  checked: number;
  changes: { student: string; from: number; to: number; flipped: string[] }[];
  applied?: number;
};

export type RegradeAllReport = {
  exams: RegradeExamReport[];
  checked: number;
  changed: number;
  applied: number;
};

export async function regradeAll(admin: Client, apply: boolean): Promise<RegradeAllReport> {
  const { data: gr } = await fetchAllPages((f, t) =>
    admin.from("grading_results").select("exam_id").order("exam_id").range(f, t)
  );
  const examIds = Array.from(new Set(((gr as any[]) ?? []).map((r) => String(r.exam_id))));
  if (!examIds.length) return { exams: [], checked: 0, changed: 0, applied: 0 };

  const { data: exams } = await admin.from("exams").select("id, code, name").in("id", examIds);
  const meta = new Map<string, { code: string; name: string }>(
    ((exams as any[]) ?? []).map((e) => [String(e.id), { code: String(e.code), name: String(e.name) }])
  );

  const out: RegradeExamReport[] = [];
  let checked = 0;
  let changed = 0;
  let applied = 0;
  for (const examId of examIds) {
    const plan = await regradePlan(admin, examId);
    checked += plan.checked;
    if (!plan.changes.length) continue;
    changed += plan.changes.length;
    // 학생 이름은 보고용으로만(제출 행에서 반·이름)
    const subIds = plan.changes.map((c) => c.submission_id);
    const { data: subs } = await admin.from("submissions").select("id, class_label, student_name").in("id", subIds);
    const who = new Map<string, string>(
      ((subs as any[]) ?? []).map((s) => [String(s.id), `${s.class_label ?? ""} ${s.student_name ?? ""}`.trim()])
    );
    const m = meta.get(examId) ?? { code: examId.slice(0, 8), name: "(이름 없음)" };
    const rep: RegradeExamReport = {
      examId,
      code: m.code,
      name: m.name,
      checked: plan.checked,
      changes: plan.changes.map((c) => ({ student: who.get(c.submission_id) ?? c.submission_id.slice(0, 8), from: c.from, to: c.to, flipped: c.flipped })),
    };
    if (apply) {
      rep.applied = await applyRegradePlan(admin, plan);
      applied += rep.applied;
    }
    out.push(rep);
  }
  return { exams: out, checked, changed, applied };
}
