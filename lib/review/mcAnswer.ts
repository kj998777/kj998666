// 객관식 답을 "고른 번호"로 맞춰 비교한다(2026-09-30 원장님 제보).
//
// 예전 AI 답·정답표·옛 입력칸은 "4", "4번", "(4)", "④ 12", "$4$"처럼 여러 모양이고, 새 입력은 ①~⑤ 버튼이라 "④"·"①③"이다.
// 글자를 그대로(또는 숫자만 모아) 비교하면 "④ 12"가 "412"가 되거나 "①③"이 "1"로 줄어드는 식으로 번호는 같은데 "AI와 다름"으로
// 떴다. 여기서는 모양이 달라도 고른 번호의 모음(정렬한 숫자, 예: "4", "13")으로 바꿔 비교한다.
// 모르는 모양이면 ""을 돌려주고, 부르는 쪽은 예전 방식(lib/grading.ts isCorrect)으로 비교한다.

const CIRC: Record<string, string> = {
  "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5",
  "❶": "1", "❷": "2", "❸": "3", "❹": "4", "❺": "5",
  "➀": "1", "➁": "2", "➂": "3", "➃": "4", "➄": "5",
  "⓵": "1", "⓶": "2", "⓷": "3", "⓸": "4", "⓹": "5",
};
const FULLWIDTH = /[０-９]/g;

function uniqSorted(ds: string[]): string {
  return Array.from(new Set(ds)).sort().join("");
}

/** 객관식 답 → 고른 번호 모음("4", "13"). 알아볼 수 없으면 "". */
export function mcChoices(s: unknown): string {
  const raw = String(s ?? "")
    .normalize("NFC")
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  // 원문자가 있으면 원문자만 본다(뒤에 붙은 값 "④ 12"의 12는 보기 내용이지 번호가 아님)
  const circ = Array.from(raw)
    .map((ch) => CIRC[ch])
    .filter(Boolean);
  if (circ.length) return uniqSorted(circ);
  const t = raw
    .replace(/\\[,;!]|\\ |\$/g, "")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/^\s*(정답|답)\s*[:：은는]?\s*/, "")
    .replace(/\s+/g, "");
  // "4", "4번", "(4)", "4)", "1,3", "1·3번", "1과3", "1또는3"(복수 정답)
  const core = t.replace(/번/g, "").replace(/^\((.*)\)$/, "$1").replace(/\)$/, "");
  if (/^[1-5]((,|，|·|\/|와|과|및|또는|그리고)?[1-5])*$/.test(core)) return uniqSorted(core.match(/[1-5]/g) ?? []);
  // "4번 (x=2)", "(4) 12"처럼 번호가 맨 앞에 확실히 표시된 경우
  const lead = /^\(?([1-5])(\)|번)/.exec(t);
  if (lead) return lead[1];
  return "";
}

/** 두 객관식 답이 같은 번호를 골랐는가. 둘 중 하나라도 알아볼 수 없으면 null(=다른 방법으로 비교). */
export function sameMcChoice(a: unknown, b: unknown): boolean | null {
  const x = mcChoices(a);
  const y = mcChoices(b);
  if (!x || !y) return null;
  return x === y;
}

/** 객관식 답이 정답표 칸과 맞는가(칸의 "|"는 여러 정답 중 하나). 알아볼 수 없으면 null. */
export function mcMatchesKeyCell(answer: unknown, keyCell: unknown): boolean | null {
  const g = mcChoices(answer);
  if (!g) return null;
  const alts = String(keyCell ?? "")
    .split("|")
    .map((x) => mcChoices(x))
    .filter(Boolean);
  if (!alts.length) return null;
  return alts.includes(g);
}
