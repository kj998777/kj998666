// 2026-10-01 원장님 제보: "디지털화할 때 \n 이 오류가 생김".
// 디지털화 지시문이 "줄바꿈은 \n 으로" 쓰라고 하는데, AI가 가끔 이스케이프를 한 번 더 해서 줄바꿈 대신 글자 그대로의
// 역슬래시+n 두 글자를 돌려준다. 그러면 화면·PDF에서 "\n"이 수식 명령으로 읽혀(normalizeTex가 $\n$으로 감쌈) 빨간 "\n"이 뜨거나
// 글자로 그대로 보인다. 여기서 그런 "\n"을 진짜 줄바꿈으로 바꾼다. 단, \neq·\notin·\nu·\nabla처럼 n으로 시작하는 LaTeX 명령과
// "\\"(줄바꿈 명령) 뒤의 n은 그대로 둔다. 브라우저·서버 공용 순수 함수.

const N_COMMANDS = new Set(
  (
    "nabla natural ncong ne nearrow neg negthickspace negthinspace negmedspace neq newline nexists ngeq ngeqq ngeqslant ngtr ni " +
    "nLeftarrow nLeftrightarrow nRightarrow nVDash nVdash nleftarrow nleftrightarrow nleq nleqq nleqslant nless nmid nobreak " +
    "nolimits nonumber normalsize not notin notni nparallel nprec npreceq nrightarrow nshortmid nshortparallel nsim nsubseteq " +
    "nsubseteqq nsucc nsucceq nsupseteq nsupseteqq ntriangleleft ntrianglelefteq ntriangleright ntrianglerighteq nu nvDash nvdash nwarrow"
  ).split(/\s+/)
);

const LETTER = /[a-zA-Z]/;

/** 글자 그대로의 "\n"(역슬래시+n)을 줄바꿈으로. LaTeX 명령(\neq 등)과 \\ 뒤의 n은 건드리지 않는다. */
export function fixLiteralNewlines(s: string): string {
  if (!s || s.indexOf("\\n") < 0) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] === "\\") j++;
    const run = j - i;
    if (run % 2 === 1 && s[j] === "n") {
      let k = j + 1;
      while (k < s.length && LETTER.test(s[k])) k++;
      const word = s.slice(j, k); // n으로 시작하는 낱말
      if (N_COMMANDS.has(word)) {
        out += s.slice(i, k);
        i = k;
        continue;
      }
      out += s.slice(i, j - 1) + "\n"; // 앞의 짝수 개 역슬래시(\\ 줄바꿈 명령)는 그대로
      i = j + 1; // n 건너뛰기
      continue;
    }
    out += s.slice(i, j);
    i = j;
  }
  return out;
}

/** 객체 안의 모든 글에 fixLiteralNewlines(디지털화 쪽 데이터 저장 전) */
export function fixLiteralNewlinesDeep<T>(v: T): T {
  if (typeof v === "string") return fixLiteralNewlines(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => fixLiteralNewlinesDeep(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = fixLiteralNewlinesDeep(x);
    return o as T;
  }
  return v;
}
