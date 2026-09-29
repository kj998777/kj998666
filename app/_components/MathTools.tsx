"use client";

// 관리자·직원이 정답·해설을 적을 때 수식을 쉽게 넣는 도구(2026-09-29 원장님 요청).
//  - MathToolbar: 분수·루트·경우 나누기(cases) 같은 수식 틀과 기호를 버튼으로 커서 자리에 넣는다.
//    커서가 이미 $…$ 안이면 틀만, 밖이면 $…$ 로 감싸서 넣는다. 글자를 골라 둔 채 누르면 그 글자가 틀 안으로 들어간다
//    (예: "3" 선택 → 분수 → $\frac{3}{}$).
//  - MathPreview: 적은 글을 PDF·보고서와 같은 모양(KaTeX)으로 바로 보여 준다.
// KaTeX는 디지털 시험지 조판과 같은 버전을 CDN에서 필요할 때만 불러온다(npm 패키지 추가 없이).

import { useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { isInsideMath, renderMathHtml } from "@/lib/math/renderMathHtml";

const KATEX_BASE = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/";
let katexPromise: Promise<any> | null = null;
function loadKatex(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).katex) return Promise.resolve((window as any).katex);
  if (!katexPromise) {
    katexPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-katex-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = KATEX_BASE + "katex.min.css";
        link.setAttribute("data-katex-css", "1");
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = KATEX_BASE + "katex.min.js";
      script.onload = () => resolve((window as any).katex);
      script.onerror = () => {
        katexPromise = null;
        reject(new Error("수식 도구를 불러오지 못했습니다."));
      };
      document.head.appendChild(script);
    });
  }
  return katexPromise;
}

export function useKatex(): any {
  const [katex, setKatex] = useState<any>(() => (typeof window !== "undefined" ? (window as any).katex ?? null : null));
  useEffect(() => {
    if (katex) return;
    let alive = true;
    loadKatex()
      .then((k) => alive && setKatex(k))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [katex]);
  return katex;
}

// ¦ = 넣은 뒤 커서가 갈 자리(고른 글자가 있으면 그 글자가 들어가는 자리)
type Tpl = { label: string; tex: string; title: string };
const TEMPLATES: Tpl[] = [
  { label: "a/b", tex: "\\frac{¦}{}", title: "분수" },
  { label: "√", tex: "\\sqrt{¦}", title: "루트" },
  { label: "ⁿ√", tex: "\\sqrt[¦]{}", title: "n제곱근" },
  { label: "xⁿ", tex: "^{¦}", title: "거듭제곱(위첨자)" },
  { label: "xₙ", tex: "_{¦}", title: "아래첨자" },
  { label: "{ 경우", tex: "\\begin{cases} ¦ & () \\\\  & () \\end{cases}", title: "경우 나누기 함수(cases)" },
  { label: "lim", tex: "\\lim_{x \\to ¦}", title: "극한" },
  { label: "Σ", tex: "\\sum_{k=1}^{¦}", title: "시그마" },
  { label: "∫", tex: "\\int_{¦}^{} \\, dx", title: "정적분" },
  { label: "log", tex: "\\log_{¦}", title: "로그" },
  { label: "AB̅", tex: "\\overline{¦}", title: "선분(윗줄)" },
  { label: "|x|", tex: "\\left|¦\\right|", title: "절댓값" },
  { label: "( )", tex: "\\left(¦\\right)", title: "큰 괄호" },
];
const SYMBOLS: Tpl[] = [
  { label: "≤", tex: "\\le ", title: "작거나 같다" },
  { label: "≥", tex: "\\ge ", title: "크거나 같다" },
  { label: "≠", tex: "\\ne ", title: "같지 않다" },
  { label: "±", tex: "\\pm ", title: "플러스마이너스" },
  { label: "×", tex: "\\times ", title: "곱하기" },
  { label: "÷", tex: "\\div ", title: "나누기" },
  { label: "·", tex: "\\cdot ", title: "점 곱" },
  { label: "π", tex: "\\pi ", title: "파이" },
  { label: "θ", tex: "\\theta ", title: "세타" },
  { label: "α", tex: "\\alpha ", title: "알파" },
  { label: "β", tex: "\\beta ", title: "베타" },
  { label: "∞", tex: "\\infty ", title: "무한대" },
  { label: "→", tex: "\\to ", title: "화살표" },
  { label: "°", tex: "^{\\circ}", title: "도" },
  { label: "∠", tex: "\\angle ", title: "각" },
  { label: "△", tex: "\\triangle ", title: "삼각형" },
  { label: "∴", tex: "\\therefore ", title: "그러므로" },
  { label: "∵", tex: "\\because ", title: "왜냐하면" },
];
const CIRCLED = ["①", "②", "③", "④", "⑤"];

type Field = HTMLInputElement | HTMLTextAreaElement;

function insertTex(el: Field | null, value: string, set: (v: string) => void, tex: string, raw = false) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const inside = raw || isInsideMath(value, start);
  let body = tex.includes("¦") ? tex.replace("¦", selected + "¦") : selected + tex + "¦";
  if (!inside) body = "$" + body + "$";
  let caret = body.indexOf("¦");
  body = body.replace("¦", "");
  // 고른 글자가 틀의 첫 칸에 들어갔으면 커서는 다음 빈칸({})으로 — 예: "3" 고르고 분수 → 분모 칸
  if (selected) {
    const nextSlot = body.indexOf("{}", caret);
    if (nextSlot >= 0) caret = nextSlot + 1;
  }
  // flushSync: 새 값이 입력칸에 바로 들어간 뒤 커서를 옮긴다(버튼 직후 바로 타자를 쳐도 제자리에 들어가게)
  flushSync(() => set(value.slice(0, start) + body + value.slice(end)));
  placeCaret(el, start + caret);
}

function placeCaret(el: Field | null, pos: number) {
  if (!el) return;
  el.focus();
  el.setSelectionRange(pos, pos);
}

function insertPlain(el: Field | null, value: string, set: (v: string) => void, text: string) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  flushSync(() => set(value.slice(0, start) + text + value.slice(end)));
  placeCaret(el, start + text.length);
}

const btn =
  "min-w-[2rem] h-8 px-1.5 inline-flex items-center justify-center rounded border border-slate-200 bg-white text-sm hover:bg-slate-50";

export function MathToolbar({
  target,
  value,
  onChange,
  circled = false,
}: {
  target: RefObject<Field | null>;
  value: string;
  onChange: (v: string) => void;
  /** 정답 표시 칸: ①~⑤ 버튼도 */
  circled?: boolean;
}) {
  // onMouseDown preventDefault: 버튼을 눌러도 입력칸의 커서·선택이 풀리지 않게
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={btn + " font-mono"} title="수식 칸 $…$ 만들기" onMouseDown={keep} onClick={() => insertTex(target.current, value, onChange, "¦", false)}>
          $…$
        </button>
        {TEMPLATES.map((t) => (
          <button key={t.title} type="button" className={btn} title={t.title} onMouseDown={keep} onClick={() => insertTex(target.current, value, onChange, t.tex)}>
            {t.label}
          </button>
        ))}
        {circled &&
          CIRCLED.map((c) => (
            <button key={c} type="button" className={btn} title={`${c} 넣기`} onMouseDown={keep} onClick={() => insertPlain(target.current, value, onChange, c)}>
              {c}
            </button>
          ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {SYMBOLS.map((t) => (
          <button key={t.title} type="button" className={btn} title={t.title} onMouseDown={keep} onClick={() => insertTex(target.current, value, onChange, t.tex)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 적은 글을 수식까지 그려서 보여 준다. 수식($ 또는 \명령)이 없으면 아무것도 안 그린다. */
export function MathPreview({ text, className = "" }: { text: string; className?: string }) {
  const katex = useKatex();
  if (!text || !/[$\\]/.test(text)) return null;
  return (
    <div className={"rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm " + className}>
      <p className="text-xs text-slate-400 mb-1">미리보기 — 해설·보고서·PDF에 이렇게 보입니다</p>
      {katex ? (
        <div className="leading-7 break-words" dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, text) }} />
      ) : (
        <p className="text-xs text-slate-400">수식 도구를 불러오는 중…</p>
      )}
    </div>
  );
}
