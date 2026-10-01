"use client";

// 2026-10-01 원장님 제보: 디지털화 시험지에서 분수가 제대로 안 그려짐(분수 줄이 분자를 지나가고, 지수가 위로 뜸).
// 화면(KaTeX)은 멀쩡한데, Safari(맥·아이패드·아이폰 — 아이폰·아이패드는 크롬도 같은 엔진)에서는 쪽을 그림으로 바꿀 때
// 브라우저 직접 그리기(SVG foreignObject)가 막혀 html2canvas로 넘어가고, html2canvas가 KaTeX의 세로 위치(분수·첨자)를
// 엉뚱하게 그린다. 그래서 그 브라우저들에서는 그림으로 바꾸기 직전에 수식(KaTeX)을 MathJax SVG(글꼴 없이 선으로 된 그림)로
// 바꿔 끼운다 — SVG는 어떤 방식으로 그려도 화면과 똑같이 나온다. 크롬·엣지(PC)는 지금처럼 그대로 둔다.

const MJ_SRC = "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg-full.js";

/** html2canvas·foreignObject로 KaTeX를 제대로 못 그리는 브라우저(Safari 계열, iOS의 모든 브라우저) */
export function needsSvgMath(): boolean {
  if (typeof navigator === "undefined") return false;
  if ((globalThis as any).__forceSvgMath) return true;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  return ios || (/AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua));
}

let ready: Promise<any> | null = null;
function loadMathJax(): Promise<any> {
  if (!ready) {
    ready = new Promise((resolve, reject) => {
      const w = window as any;
      if (w.MathJax?.tex2svg) return resolve(w.MathJax);
      w.MathJax = {
        tex: { packages: { "[+]": ["ams", "newcommand", "noerrors", "noundefined"] } },
        svg: { fontCache: "none" }, // 수식마다 글자 모양을 SVG 안에 다 넣는다(그림으로 바꿔도 빠지지 않게)
        startup: {
          typeset: false,
          ready: () => {
            w.MathJax.startup.defaultReady();
            w.MathJax.startup.promise.then(() => resolve(w.MathJax), reject);
          },
        },
      };
      const s = document.createElement("script");
      s.src = MJ_SRC;
      s.async = true;
      s.onerror = () => reject(new Error("수식 그리기 도구(MathJax)를 불러오지 못했습니다."));
      document.head.appendChild(s);
    });
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

/** MathJax SVG의 크기·세로 위치(ex 단위)를 지금 그려진 px로 고정 — html2canvas는 SVG를 따로 떼어 그리므로 ex가 다른 글꼴 기준이 돼 잘린다 */
function pinPx(svg: SVGSVGElement) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const fs = parseFloat(getComputedStyle(svg).fontSize) || 16;
  const va = svg.style.verticalAlign; // 예: "-0.566ex"
  const m = /^(-?[\d.]+)ex$/.exec(va || "");
  if (m) svg.style.verticalAlign = (parseFloat(m[1]) * exPx(svg, fs)).toFixed(2) + "px";
  svg.setAttribute("width", r.width.toFixed(2) + "px");
  svg.setAttribute("height", r.height.toFixed(2) + "px");
}

/** 그 자리 글꼴의 1ex가 몇 px인지 */
function exPx(el: Element, fs: number): number {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;height:1ex;width:0;padding:0;border:0";
  el.parentElement?.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h || fs * 0.43;
}

/**
 * root 안의 KaTeX 수식을 같은 TeX의 MathJax SVG로 바꿔 끼운다(KaTeX가 남겨 둔 원래 TeX 글을 읽는다).
 * 크기는 KaTeX와 맞춘다(KaTeX 글자 크기 = 둘레 글자의 1.21배, MathJax 크기 단위 ex는 둘레 글꼴을 따르므로 KaTeX 글꼴로 맞춤). 바꾼 수식 개수를 돌려준다. 실패한 수식은 그대로 둔다.
 */
export async function svgifyKatex(root: HTMLElement): Promise<number> {
  const list = Array.from(root.querySelectorAll<HTMLElement>(".katex"));
  if (!list.length) return 0;
  const MJ = await loadMathJax();
  let n = 0;
  for (const el of list) {
    if (!el.isConnected || el.closest(".mjsvg")) continue;
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (!tex) continue;
    const display = !!el.closest(".katex-display");
    try {
      const node: HTMLElement = MJ.tex2svg(tex, { display });
      const svg = node.querySelector("svg");
      if (!svg || node.querySelector("[data-mjx-error]")) continue;
      const wrap = document.createElement("span");
      wrap.className = "mjsvg";
      wrap.style.cssText = `font-size:1.21em;font-family:KaTeX_Main,"Times New Roman",serif;line-height:normal;text-indent:0;white-space:nowrap;${display ? "display:block;text-align:center;margin:0.5em 0" : "display:inline-block"}`;
      wrap.appendChild(svg);
      const target = display ? (el.closest(".katex-display") as HTMLElement) : el;
      target.replaceWith(wrap);
      pinPx(svg);
      n++;
    } catch {
      /* 그 수식은 KaTeX 그대로 */
    }
  }
  return n;
}
