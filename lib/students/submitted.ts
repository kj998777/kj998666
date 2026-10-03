// 2026-10-03 원장님: "학생별로 제출한 시험을 볼 수 있게 하는 탭". 한 학생이 낸 시험(다시 낸 것 포함)을 최신순으로,
// 시험마다 문항별 낸 답·정답·맞음/틀림·찍음·풀이를 한 묶음으로 만든다. 원장님 학생 화면(/students/[key]?tab=subs)과
// 과외선생님 "내 학생"(/tutor/students)이 같이 쓰는 순수 계산(브라우저·서버 공용, test/submittedExams.test.ts).
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { normName, type Difficulty, type ExamMeta, type ItemMeta, type SubRow } from "@/lib/students/analysis";

export type AnswerRow = {
  label: string;
  type: "객관식" | "주관식";
  points: number;
  earned: number;
  given: string;
  ok: boolean;
  blank: boolean;
  guessed: boolean;
  unit: string;
  difficulty: Difficulty | "";
  /** 정답(보여 줄 수 없으면 null — 과외선생님이 구매를 취소한 시험 등) */
  key: string | null;
  answerDisplay: string;
  problem: string;
  solution: string;
};

export type SubmittedExam = {
  submissionId: string;
  examId: string;
  code: string;
  name: string;
  classLabel: string;
  submittedAt: string;
  score: number;
  realScore: number;
  max: number;
  rate: number | null;
  correct: number;
  wrong: number;
  blank: number;
  guessed: number;
  guessedCorrect: number;
  /** 같은 시험을 여러 번 냈을 때 몇 번째인지(1부터, 한 번만 냈으면 null) */
  attempt: number | null;
  /** 정답·풀이를 보여 줄 수 있는지 */
  showKey: boolean;
  rows: AnswerRow[];
};

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

/** 객관식 답 "3" → "③", 여러 개 "13" → "①③" */
export function circled(type: string, v: string): string {
  const t = String(v ?? "").trim();
  if (type === "객관식" && /^[1-5]+$/.test(t)) return t.split("").map((c) => CIRC[c]).join("");
  return t;
}

/** 정답표 correct_answers("3|4" = 3 또는 4)를 읽기 좋게 */
export function keyText(type: string, raw: string): string {
  const alts = String(raw ?? "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  return alts.map((x) => circled(type, x)).join(" 또는 ");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildSubmittedExams(
  subs: SubRow[],
  exams: Map<string, ExamMeta>,
  items: ItemMeta[],
  showKey: (examId: string) => boolean = () => true
): SubmittedExam[] {
  const byExam = new Map<string, ItemMeta[]>();
  for (const it of items) {
    const l = byExam.get(it.exam_id) ?? [];
    l.push(it);
    byExam.set(it.exam_id, l);
  }
  // 같은 시험을 몇 번 냈는지(오래된 것부터 1, 2, …)
  const nth = new Map<string, number>();
  const count = new Map<string, number>();
  for (const s of subs) count.set(s.exam_id, (count.get(s.exam_id) ?? 0) + 1);
  for (const s of [...subs].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    const k = (nth.get("e" + s.exam_id) ?? 0) + 1;
    nth.set("e" + s.exam_id, k);
    nth.set(s.id, k);
  }

  const out: SubmittedExam[] = [];
  for (const s of subs) {
    const exam = exams.get(s.exam_id);
    if (!exam) continue;
    const show = showKey(s.exam_id);
    const its = new Map((byExam.get(s.exam_id) ?? []).map((i) => [i.label, i]));
    const order = new Map((byExam.get(s.exam_id) ?? []).map((i) => [i.label, i.sort_order]));
    const per = [...(s.per_item ?? [])].sort((a, b) => {
      const oa = order.get(String(a.item_label)) ?? 1e9;
      const ob = order.get(String(b.item_label)) ?? 1e9;
      return oa - ob || String(a.item_label).localeCompare(String(b.item_label), "ko", { numeric: true });
    });
    const rows: AnswerRow[] = per.map((p) => {
      const it = its.get(String(p.item_label));
      const type = it?.type ?? "객관식";
      const given = String(p.given ?? "").trim();
      const blank = !p.correct && given === "";
      return {
        label: String(p.item_label),
        type,
        points: it ? it.points : 0,
        earned: Number(p.points) || 0,
        given: blank ? "" : circled(type, given),
        ok: !!p.correct,
        blank,
        guessed: !!p.guessed,
        unit: it?.unit ?? "",
        difficulty: it?.difficulty ?? "",
        key: show && it ? keyText(type, it.correct_answers ?? "") || null : null,
        // 2026-10-03: 정답 표시가 정답표와 다르면 정답표를 보여 준다(lib/review/answerMatch.ts) — 채점 기준과 어긋나지 않게.
        answerDisplay: show && it ? reconcileKeyDisplay(type, it.correct_answers ?? "", it.answer_display ?? "").text : "",
        problem: show ? it?.problem_statement ?? "" : "",
        solution: show ? it?.solution ?? "" : "",
      };
    });
    const correct = rows.filter((r) => r.ok).length;
    const blank = rows.filter((r) => r.blank).length;
    const guessedPts = rows.reduce((a, r) => a + (r.guessed && r.ok ? r.earned : 0), 0);
    const max = exam.max || rows.reduce((a, r) => a + r.points, 0);
    out.push({
      submissionId: s.id,
      examId: s.exam_id,
      code: exam.code,
      name: exam.name,
      classLabel: normName(s.class_label),
      submittedAt: s.submitted_at,
      score: r2(s.total_score),
      realScore: r2(s.total_score - guessedPts),
      max: r2(max),
      rate: max > 0 ? s.total_score / max : rows.length ? correct / rows.length : null,
      correct,
      wrong: rows.length - correct - blank,
      blank,
      guessed: rows.filter((r) => r.guessed).length,
      guessedCorrect: rows.filter((r) => r.guessed && r.ok).length,
      attempt: (count.get(s.exam_id) ?? 0) > 1 ? nth.get(s.id) ?? null : null,
      showKey: show,
      rows,
    });
  }
  return out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.name.localeCompare(b.name));
}
