// 오답 유사문제 고르기(2026-10-05 원장님: "같은 논리 유형으로 묶인 문제들 중에서도 난이도를 나눠서, 어떤 시험을
// 틀렸으면 그 시험의 유사문제도 학습할 수 있게"). DB·네트워크를 쓰지 않는 순수 계산 — test/similar.test.ts가 검증한다.
//
// 규칙
//  - 학생이 틀린(또는 찍어서 맞힌) 문항마다, 같은 논리 유형(item_explanations.logic_type)인 다른 시험 문항에서
//    난이도 "한 단계 쉬운 것 1개 → 같은 것 2개 → 한 단계 어려운 것 1개"를 고른다. 한쪽 칸이 비면 같은 난이도에서 더 채운다.
//  - 후보: 다른 시험, 정답이 확정된 시험(검수대기 제외), 시험지 오류 의심이 아닌 것, 시험지에서 쪽을 아는 것(잘라 보여 줘야 함).
//  - 같은 시험지를 두 번 올린 경우(연도·학년·정답표가 같음)는 한 시험으로 합쳐 같은 문제가 두 번 나오지 않게 한다(examTwins).
//  - 한 학생 화면에서 같은 문항이 두 번 나오지 않게 하고, 고르는 순서는 제출 id로 섞어 새로고침해도 그대로다.

export const DIFFS = ["하", "중하", "중", "중상", "상"] as const;

export type SourceItem = {
  label: string;
  logicType: string | null;
  difficulty: string;
  correctAnswers: string;
  year: string | null;
  grade: number | null;
};

export type PoolItem = {
  id: string;
  examId: string;
  label: string;
  logicType: string;
  difficulty: string;
  correctAnswers: string;
  year: string | null;
  grade: number | null;
  /** 정답 확정·오류 의심 아님·쪽 정보 있음 — 부르는 쪽이 미리 거른 결과 */
  usable: boolean;
};

export type Tier = "easier" | "same" | "harder";
export type Pick = { item: PoolItem; tier: Tier };

/**
 * 같은 시험지를 두 번 올린 시험 묶기 — 연도·학년이 같고 정답표(정답들의 모임)가 똑같으면 같은 시험지로 본다
 * (번호 매김은 다를 수 있음: "단답형1" ↔ "22"). 돌려주는 값: 시험 id → 대표 시험 id(묶음에서 id가 가장 작은 것).
 * 문항이 5개 미만인 시험은 묶지 않는다(우연히 같을 수 있어서).
 */
export function examTwins(exams: { id: string; year: string | null; grade: number | null; answers: string[] }[]): Map<string, string> {
  const byPrint = new Map<string, string[]>();
  for (const e of exams) {
    const ans = e.answers.map((a) => String(a ?? "").replace(/\s+/g, "")).filter(Boolean);
    if (ans.length < 5) continue;
    const key = [e.year ?? "", e.grade ?? "", [...ans].sort().join("¦")].join("|");
    const arr = byPrint.get(key) ?? [];
    arr.push(e.id);
    byPrint.set(key, arr);
  }
  const canon = new Map<string, string>();
  for (const e of exams) canon.set(e.id, e.id);
  for (const ids of Array.from(byPrint.values())) {
    if (ids.length < 2) continue;
    const head = [...ids].sort()[0];
    for (const id of ids) canon.set(id, head);
  }
  return canon;
}

/** 문자열 → 0~2^32 (FNV-1a). 제출 id와 섞어 순서를 정한다. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function diffIndex(d: string): number {
  const i = (DIFFS as readonly string[]).indexOf(d);
  return i < 0 ? 2 : i;
}

export const PER_TIER: Record<Tier, number> = { easier: 1, same: 2, harder: 1 };

/**
 * 틀린 문항 하나에 대한 유사문제. used: 이 학생 화면에서 이미 고른 문항 id(겹치지 않게 — 고른 것을 여기에 더함).
 */
export function pickSimilar(src: SourceItem, srcExamId: string, pool: PoolItem[], seed: string, used: Set<string> = new Set()): Pick[] {
  if (!src.logicType) return [];
  // 같은 시험지를 두 번 올린 시험은 부르는 쪽이 examTwins로 대표 시험 하나로 합쳐 넘긴다(srcExamId도 대표 id).
  const cands = pool
    .filter((p) => p.usable && p.logicType === src.logicType && p.examId !== srcExamId && !used.has(p.id))
    .sort((a, b) => hash32(seed + "|" + src.label + "|" + a.id) - hash32(seed + "|" + src.label + "|" + b.id) || a.id.localeCompare(b.id));
  const d = diffIndex(src.difficulty);
  const at = (i: number) => cands.filter((p) => diffIndex(p.difficulty) === i);
  const easier = d > 0 ? at(d - 1) : [];
  const same = at(d);
  const harder = d < DIFFS.length - 1 ? at(d + 1) : [];

  const out: Pick[] = [];
  const take = (arr: PoolItem[], n: number, tier: Tier) => {
    for (const p of arr) {
      if (n <= 0) break;
      if (out.some((o) => o.item.id === p.id)) continue;
      out.push({ item: p, tier });
      n--;
    }
    return n; // 못 채운 개수
  };
  const leftE = take(easier, PER_TIER.easier, "easier");
  const leftH = harder.length ? PER_TIER.harder : 0;
  // 같은 난이도: 기본 2개 + 쉬운 칸·어려운 칸이 비었으면 그만큼 더
  take(same, PER_TIER.same + leftE + (harder.length ? 0 : PER_TIER.harder), "same");
  if (leftH) take(harder, PER_TIER.harder, "harder");
  // 같은 난이도도 모자라면 두 단계 떨어진 것으로라도(쉬운 쪽 먼저) — 비어 있는 것보다 낫다
  if (out.length === 0) {
    const far = [...(d > 1 ? at(d - 2) : []), ...(d < DIFFS.length - 2 ? at(d + 2) : [])];
    take(far, 2, "same");
  }
  const order: Tier[] = ["easier", "same", "harder"];
  out.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || diffIndex(a.item.difficulty) - diffIndex(b.item.difficulty));
  for (const o of out) used.add(o.item.id);
  return out;
}

/** 학생 제출 결과에서 유사문제를 볼 문항: 틀린 것·무응답, 그리고 찍어서 맞힌 것 */
export function targetsOf(perItem: { item_label: string; correct?: boolean; given?: string; guessed?: boolean }[] | null | undefined) {
  return (perItem ?? [])
    .filter((p) => !p.correct || p.guessed)
    .map((p) => ({ label: String(p.item_label), kind: (p.correct ? "guessed" : String(p.given ?? "").trim() ? "wrong" : "blank") as "wrong" | "blank" | "guessed" }));
}
