// 글 속 $…$ 수식을 KaTeX HTML로 바꾼다(화면 미리보기용). 디지털 시험지 조판(buildDigitizedPdf.ts의 dgTex)과
// 같은 규칙: normalizeTex로 $$…$$·\[…\]·$ 없는 명령을 $…$ 로 맞춘 뒤, $ 짝이 안 맞으면 마지막 조각만 글자로 둔다.
// 여러 줄 수식(cases·행렬·\\)은 행 간격을 넓히고 위아래 여백을 둔다(2026-09-29).
import { normalizeTex } from "@/lib/math/normalizeTex";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMathHtml(katex: any, text: string | null | undefined): string {
  const s = normalizeTex(String(text ?? ""));
  const parts = s.split("$");
  const unpaired = parts.length % 2 === 0;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const trailing = unpaired && i === parts.length - 1;
    if (i % 2 === 1 && !trailing && katex) {
      const tall = /\\begin\{|\\\\/.test(parts[i]);
      try {
        const html = katex.renderToString(tall ? `\\def\\arraystretch{1.4}${parts[i]}` : parts[i], { throwOnError: false });
        out.push(tall ? `<span style="display:inline-block;padding:6px 0;line-height:1.5">${html}</span>` : html);
      } catch {
        out.push(esc(parts[i]));
      }
    } else {
      const t = trailing ? "$" + parts[i] : i % 2 === 1 ? "$" + parts[i] + "$" : parts[i];
      // 2026-10-03: 해설 지시문이 줄바꿈을 <br>, 강조를 <b>로 쓰라고 하므로(lib/ai/prompts.ts) 그 두 태그만 살린다 — 보고서 PDF의 mathHtml과 같은 규칙.
      out.push(
        esc(t)
          .replace(/&lt;(\/?)(b|br)\s*\/?&gt;/gi, (_m, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`)
          .replace(/\n/g, "<br>")
      );
    }
  }
  return out.join("");
}

/** 커서 앞에 $ 가 홀수 개면 수식 안이다(\$ 는 세지 않음). */
export function isInsideMath(text: string, pos: number): boolean {
  const before = text.slice(0, pos).replace(/\\\$/g, "");
  return ((before.match(/\$/g) || []).length) % 2 === 1;
}
