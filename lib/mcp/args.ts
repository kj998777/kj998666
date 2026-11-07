// 메딕차트 MCP 도구 인자 검사(순수 함수, test/mcpArgs.test.ts). 틀린 값이면 ToolError — Claude가 읽고 고쳐 다시 부르도록
// 한국어로 무엇이 틀렸는지 말한다.

export class ToolError extends Error {}

export type Args = Record<string, unknown>;

export function asArgs(v: unknown): Args {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Args) : {};
}

export function str(a: Args, key: string, opt: { required?: boolean; max?: number; trim?: boolean } = {}): string | undefined {
  const v = a[key];
  if (v === undefined || v === null || v === "") {
    if (opt.required) throw new ToolError(`${key}이(가) 필요합니다.`);
    return undefined;
  }
  if (typeof v !== "string" && typeof v !== "number") throw new ToolError(`${key}는 글자여야 합니다.`);
  let s = String(v).normalize("NFC");
  if (opt.trim !== false) s = s.trim();
  if (opt.required && !s) throw new ToolError(`${key}이(가) 필요합니다.`);
  if (opt.max && s.length > opt.max) throw new ToolError(`${key}가 너무 깁니다(최대 ${opt.max}자).`);
  return s;
}

export function int(a: Args, key: string, opt: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = a[key];
  if (v === undefined || v === null || v === "") {
    if (opt.required) throw new ToolError(`${key}이(가) 필요합니다.`);
    return undefined;
  }
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n)) throw new ToolError(`${key}는 정수여야 합니다.`);
  if (opt.min !== undefined && n < opt.min) throw new ToolError(`${key}는 ${opt.min} 이상이어야 합니다.`);
  if (opt.max !== undefined && n > opt.max) throw new ToolError(`${key}는 ${opt.max} 이하여야 합니다.`);
  return n;
}

export function num(a: Args, key: string, opt: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = a[key];
  if (v === undefined || v === null || v === "") {
    if (opt.required) throw new ToolError(`${key}이(가) 필요합니다.`);
    return undefined;
  }
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new ToolError(`${key}는 숫자여야 합니다.`);
  if (opt.min !== undefined && n < opt.min) throw new ToolError(`${key}는 ${opt.min} 이상이어야 합니다.`);
  if (opt.max !== undefined && n > opt.max) throw new ToolError(`${key}는 ${opt.max} 이하여야 합니다.`);
  return n;
}

export function bool(a: Args, key: string, def?: boolean): boolean | undefined {
  const v = a[key];
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  throw new ToolError(`${key}는 true/false여야 합니다.`);
}

export function oneOf<T extends string>(a: Args, key: string, values: readonly T[], opt: { required?: boolean } = {}): T | undefined {
  const s = str(a, key, opt);
  if (s === undefined) return undefined;
  if (!(values as readonly string[]).includes(s)) throw new ToolError(`${key}는 ${values.join(" / ")} 중 하나여야 합니다.`);
  return s as T;
}

export function obj(a: Args, key: string, opt: { required?: boolean } = {}): Record<string, unknown> | undefined {
  const v = a[key];
  if (v === undefined || v === null) {
    if (opt.required) throw new ToolError(`${key}이(가) 필요합니다.`);
    return undefined;
  }
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) return p;
    } catch {
      /* 아래로 */
    }
  }
  if (typeof v !== "object" || Array.isArray(v)) throw new ToolError(`${key}는 객체(JSON)여야 합니다.`);
  return v as Record<string, unknown>;
}

export function arr(a: Args, key: string, opt: { required?: boolean; max?: number } = {}): unknown[] | undefined {
  const v = a[key];
  if (v === undefined || v === null) {
    if (opt.required) throw new ToolError(`${key}이(가) 필요합니다.`);
    return undefined;
  }
  let x: unknown = v;
  if (typeof v === "string") {
    try {
      x = JSON.parse(v);
    } catch {
      /* 아래로 */
    }
  }
  if (!Array.isArray(x)) throw new ToolError(`${key}는 배열이어야 합니다.`);
  if (opt.max && x.length > opt.max) throw new ToolError(`${key}는 최대 ${opt.max}개까지입니다.`);
  return x;
}

/** 시험 코드 */
export function examCode(a: Args): string {
  const c = str(a, "code", { required: true, max: 80 })!;
  return c;
}

/** PostgREST or() 필터에 넣을 검색어 — 쉼표·괄호·% 같은 특수 문자를 뺀다 */
export function searchWord(s: string): string {
  return s.replace(/[,()%*\\"'.:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** 로그에 남길 인자: 긴 글(그림·PDF base64 등)은 길이만 */
export function auditArgs(a: Args): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "string" && v.length > 300) out[k] = `<${v.length}자>`;
    else if (v && typeof v === "object") {
      const s = JSON.stringify(v);
      out[k] = s.length > 2000 ? `<${s.length}자 JSON>` : v;
    } else out[k] = v;
  }
  return out;
}

/** PDF 바이트인지(첫 1KB 안에 %PDF-) */
export function looksLikePdf(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 1024))).toString("latin1");
  return head.includes("%PDF-");
}
