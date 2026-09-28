import "server-only";
import { isCorrect } from "@/lib/grading";

// 정답표(answer_key)가 바뀐 뒤 이미 들어온 제출을 새 정답으로 다시 채점한다.
// 지금까지는 정답을 고쳐도 기존 채점 결과가 그대로 남았다(#3/#4에서 과외선생님 답 채택·수정 요청
// 반영으로 정답이 바뀌는 일이 생기면서 필요해짐). grading_results는 클라이언트 쓰기 정책이 없으므로
// 반드시 서비스롤 클라이언트로 부른다. 학생 답은 채점 결과(per_item)에 문항 번호와 함께 저장돼 있으므로
// 번호로 맞춰 다시 채점한다(정답표 줄 수가 달라져도 안전).

type Client = any;
type PerItem = { item_label: string; given: string; correct: boolean; points: number };

export async function regradeExam(admin: Client, examId: string): Promise<number> {
  const [{ data: keys }, { data: results }] = await Promise.all([
    admin.from("answer_key").select("item_label, correct_answers, points").eq("exam_id", examId).order("sort_order").order("item_label"),
    admin.from("grading_results").select("id, per_item, total_score").eq("exam_id", examId),
  ]);
  const key = (keys as any[]) ?? [];
  if (!key.length) return 0;

  let changed = 0;
  for (const r of (results as any[]) ?? []) {
    const old: PerItem[] = Array.isArray(r.per_item) ? r.per_item : [];
    const givenBy = new Map(old.map((p) => [p.item_label, p.given ?? ""]));
    let total = 0;
    const perItem: PerItem[] = key.map((k) => {
      const given = String(givenBy.get(k.item_label) ?? "");
      const correct = isCorrect(given, k.correct_answers);
      const pts = Number(k.points) || 0;
      if (correct) total += pts;
      return { item_label: k.item_label, given, correct, points: correct ? pts : 0 };
    });
    total = Math.round(total * 100) / 100;
    const same =
      Number(r.total_score) === total &&
      old.length === perItem.length &&
      perItem.every((p, i) => old[i]?.item_label === p.item_label && !!old[i]?.correct === p.correct);
    if (same) continue;
    const { error } = await admin.from("grading_results").update({ per_item: perItem, total_score: total }).eq("id", r.id);
    if (!error) changed++;
  }
  return changed;
}
