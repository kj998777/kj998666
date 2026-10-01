import { fixLiteralNewlines } from "@/lib/math/literalNewline";
// 수식 표기 정리(2026-09-28 원장님 제보: 디지털화 시험지에 "g(x)=\begin{cases} … \end{cases}"처럼 수식이
// 명령어 글자 그대로 남는 경우).
//
// 화면·PDF는 글 속의 $…$ 만 KaTeX 수식으로 그린다. 그런데 AI가 가끔
//   ① 여러 줄 수식(\begin{cases} 등)을 $$…$$ 로 감싸거나(→ $ 로 나누면 가운데가 "글"이 됨)
//   ② \[…\], \(…\) 로 감싸거나
//   ③ 아예 $ 없이 \dfrac, \lim, \neq 같은 명령을 그대로 쓴다.
// 이 함수는 그런 글을 "수식은 모두 $…$ 한 쌍" 형태로 바꿔 준다. 이미 올바른 글은 그대로 둔다.
// 브라우저·서버 어디서나 쓰는 순수 함수(디지털화 PDF, 성적 보고서 공용).

const MATH_CH = /[A-Za-z0-9()[\]=+\-*/^_.,'|<>!:;~ ]/; // $ 없는 수식으로 볼 수 있는 글자(한글·줄바꿈 제외)

function bareSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}|\\[a-zA-Z]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let s = m.index;
    let e = m.index + m[0].length;
    // 오른쪽: 중괄호 안은 무엇이든, 밖은 수식 글자만
    let depth = 0;
    while (e < text.length) {
      const ch = text[e];
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && ch === "\\" && /[a-zA-Z\\,;!]/.test(text[e + 1] ?? "")) {
        // 이어지는 명령(\neq, \\ 등)
      } else if (depth === 0 && !MATH_CH.test(ch)) break;
      e++;
    }
    // 왼쪽: 수식 글자만
    while (s > 0 && MATH_CH.test(text[s - 1])) s--;
    // 가장자리의 공백·문장부호는 글로 남긴다
    while (s < e && /[\s.,:;]/.test(text[s])) s++;
    while (e > s && /[\s.,:;]/.test(text[e - 1])) e--;
    if (e > s) spans.push([s, e]);
    re.lastIndex = Math.max(re.lastIndex, e);
  }
  // 겹치거나 붙은 구간 합치기
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  return merged;
}

function wrapBare(text: string): string {
  if (!/\\[a-zA-Z]/.test(text)) return text;
  // \[…\] → 수식, \(…\) → 수식
  text = text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, x) => `$\\displaystyle ${String(x).trim()}$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, x) => `$${String(x).trim()}$`);
  // 위에서 만든 $…$ 는 건너뛰고 나머지 글만 처리
  const parts = text.split("$");
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i];
    const spans = bareSpans(t);
    if (!spans.length) continue;
    let out = "";
    let pos = 0;
    for (const [s, e] of spans) {
      out += t.slice(pos, s) + "$" + t.slice(s, e) + "$";
      pos = e;
    }
    parts[i] = out + t.slice(pos);
  }
  return parts.join("$");
}

/** 글 속 수식을 모두 $…$ 한 쌍으로 정리한다. */
export function normalizeTex(input: string | null | undefined): string {
  // 2026-10-01: AI가 줄바꿈을 글자 그대로의 "\n"으로 준 경우 진짜 줄바꿈으로(\neq 등 명령은 그대로) — lib/math/literalNewline.ts
  let s = fixLiteralNewlines(String(input ?? ""));
  if (!s.includes("\\") && !s.includes("$$")) return s;
  // ① $$…$$ → $\displaystyle …$
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, x) => `$\\displaystyle ${String(x).trim()}$`);
  const parts = s.split("$");
  if (parts.length % 2 === 0) return s; // $ 짝이 안 맞으면 손대지 않음(그리는 쪽에서 따로 처리)
  // ②③ $ 밖의 글만 정리
  for (let i = 0; i < parts.length; i += 2) parts[i] = wrapBare(parts[i]);
  return parts.join("$");
}
