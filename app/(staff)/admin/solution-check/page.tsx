import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { checkSolution, type SolutionCheck } from "@/lib/review/solutionCheck";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { MathPreview } from "@/app/_components/MathTools";

// 풀이 결론 점검(2026-10-03 원장님 제보 "해설지 정답하고 풀이가 다른 경우가 있음"). 모든 시험의 문항 풀이 끝부분에서
// 고른 번호·마지막 값을 읽어 정답표·정답 표시와 비교하고(lib/review/solutionCheck.ts), 다른 것만 모아 보여 준다.
// 자동으로 고치지 않는다 — 어느 쪽이 맞는지는 사람이 풀어서 시험 상세(정답표·문항 해설)에서 고친다.
// 관리자 전용, 서비스롤로 한 번에 읽는다(문항 1천여 개, 수 초).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = {
  examId: string;
  code: string;
  name: string;
  status: string;
  label: string;
  type: string;
  key: string;
  display: string;
  problem: string;
  solution: string;
  check: SolutionCheck;
  displayMismatch: boolean;
  subs: number;
};

export default async function SolutionCheckPage({ searchParams }: { searchParams?: { all?: string } }) {
  await requireRole("admin");
  const admin = createAdminClient();
  const showAll = searchParams?.all === "1";

  const [{ data: exams }, { data: keys }, { data: expl }, { data: subs }] = await Promise.all([
    fetchAllPages((f, t) => admin.from("exams").select("id, code, name, status").order("created_at", { ascending: false }).range(f, t)),
    fetchAllPages((f, t) => admin.from("answer_key").select("exam_id, item_label, correct_answers, type, sort_order").order("id").range(f, t)),
    fetchAllPages((f, t) =>
      admin.from("item_explanations").select("exam_id, item_label, answer_display, solution, problem_statement").order("id").range(f, t)
    ),
    fetchAllPages((f, t) => admin.from("submissions").select("exam_id").order("id").range(f, t)),
  ]);
  const examById = new Map<string, any>(((exams as any[]) ?? []).map((e) => [String(e.id), e]));
  const subCount = new Map<string, number>();
  for (const s of (subs as any[]) ?? []) subCount.set(String(s.exam_id), (subCount.get(String(s.exam_id)) ?? 0) + 1);
  const explBy = new Map<string, any>(((expl as any[]) ?? []).map((x) => [`${x.exam_id}|${x.item_label}`, x]));

  const rows: Row[] = [];
  let checked = 0;
  for (const k of (keys as any[]) ?? []) {
    const x = explBy.get(`${k.exam_id}|${k.item_label}`);
    if (!x || !String(x.solution ?? "").trim()) continue;
    checked++;
    const e = examById.get(String(k.exam_id));
    const check = checkSolution(k.type, String(k.correct_answers ?? ""), String(x.answer_display ?? ""), String(x.solution ?? ""));
    const displayMismatch = reconcileKeyDisplay(k.type, String(k.correct_answers ?? ""), String(x.answer_display ?? "")).mismatch;
    if (!check.flagged && !displayMismatch) continue;
    rows.push({
      examId: String(k.exam_id),
      code: e?.code ?? "",
      name: e?.name ?? "(시험 없음)",
      status: e?.status ?? "",
      label: String(k.item_label),
      type: k.type,
      key: String(k.correct_answers ?? ""),
      display: String(x.answer_display ?? ""),
      problem: String(x.problem_statement ?? ""),
      solution: String(x.solution ?? ""),
      check,
      displayMismatch,
      subs: subCount.get(String(k.exam_id)) ?? 0,
    });
  }
  // 강한 신호(번호 불일치·정답 표시 불일치)를 앞에, 그다음 값 불일치, 그다음 "재계산" 같은 표현만 있는 것
  const weight = (r: Row) =>
    (r.displayMismatch ? 100 : 0) +
    (r.check.reasons.some((s) => s.includes("정답표는")) ? 50 : 0) +
    (r.check.reasons.some((s) => s.includes("마지막 값")) ? 20 : 0) +
    (r.check.doubtWords.length ? 5 : 0);
  const strong = rows.filter((r) => weight(r) >= 20);
  const weak = rows.filter((r) => weight(r) < 20);
  const shown = showAll ? rows : strong;

  const byExam = new Map<string, Row[]>();
  for (const r of shown) {
    const l = byExam.get(r.examId) ?? [];
    l.push(r);
    byExam.set(r.examId, l);
  }
  const groups = Array.from(byExam.values()).sort((a, b) => b.length - a.length);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">풀이 결론 점검</h1>
        <p className="text-sm text-slate-500">
          풀이 글의 끝부분(고른 번호·마지막 값)이 정답표·정답 표시와 다른 문항입니다. 풀이 {checked}문항을 살펴 {rows.length}문항이
          걸렸습니다(그중 번호·값이 다른 강한 신호 {strong.length}, &ldquo;재계산&rdquo; 같은 표현만 있는 약한 신호 {weak.length}). 자동으로
          고치지 않으니 문제를 직접 풀어 보고 시험 상세에서 정답표나 풀이를 고쳐 주세요.
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {showAll ? (
            <Link href="/admin/solution-check" className="link-accent">강한 신호만 보기</Link>
          ) : (
            <Link href="/admin/solution-check?all=1" className="link-accent">약한 신호까지 모두 보기 ({rows.length})</Link>
          )}
        </p>
      </div>

      {groups.length === 0 && <div className="card text-sm text-slate-500">걸린 문항이 없습니다.</div>}

      {groups.map((list) => {
        const first = list[0];
        return (
          <div key={first.examId} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                <Link href={`/exams/${encodeURIComponent(first.code)}`} className="hover:underline">
                  {first.name} <span className="text-slate-400 font-normal text-sm">({first.code})</span>
                </Link>
              </h2>
              <div className="flex gap-1 text-xs">
                <span className="badge bg-slate-100 text-slate-600">{first.status}</span>
                <span className={"badge " + (first.subs ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500")}>제출 {first.subs}건</span>
                <span className="badge bg-red-100 text-red-700">{list.length}문항</span>
              </div>
            </div>
            <div className="space-y-2">
              {list
                .sort((a, b) => Number(a.label) - Number(b.label) || a.label.localeCompare(b.label))
                .map((r) => (
                  <details key={r.label} className="border border-slate-200 rounded px-3 py-2">
                    <summary className="cursor-pointer text-sm flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.label}번</span>
                      <span className="text-slate-500">
                        정답표 <b>{r.key}</b>
                        {r.display ? <> · 표시 <b>{r.display}</b></> : null}
                        {r.check.solValue ? <> · 풀이 마지막 값 <b>{r.check.solValue}</b></> : null}
                        {r.check.solChoice ? <> · 풀이 번호 <b>{r.check.solChoice}</b></> : null}
                      </span>
                      {r.displayMismatch && <span className="badge bg-amber-100 text-amber-800">정답 표시 ≠ 정답표</span>}
                      {r.check.reasons.map((s, i) => (
                        <span key={i} className="badge bg-red-50 text-red-700">{s}</span>
                      ))}
                    </summary>
                    <div className="mt-2 text-sm space-y-2">
                      {r.problem && (
                        <div>
                          <p className="text-xs text-slate-500 mb-1">문제</p>
                          <MathPreview text={r.problem} />
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500 mb-1">풀이</p>
                        <MathPreview text={r.solution} />
                      </div>
                      <Link href={`/exams/${encodeURIComponent(r.code)}`} className="link-accent text-xs">
                        시험 상세에서 고치기 →
                      </Link>
                    </div>
                  </details>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
