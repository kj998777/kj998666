import "server-only";

// Anthropic API 저수준 호출 래퍼. Apps Script Code.gs의 aiCall_/batchGet_/batchResults_/
// toolInput_/failWhy_/addUsage_ 를 그대로 포팅(문법만 TS로). 이 파일은 순수하게 HTTP 통신만
// 담당하고, 상태 저장(Postgres)이나 파이프라인 순서는 lib/ai/pipeline.ts 가 맡는다.
//
// Apps Script와의 차이점: UrlFetchApp은 응답을 최대 60초까지만 기다려서 풀이를 전부 Message
// Batches(비동기)로 처리해야 했는데, Vercel 서버리스 함수도 사정은 비슷하다(무료 플랜 실행 시간
// 제한). 그래서 여기서도 배치 API를 그대로 쓴다 — 다만 결과를 기다리는 주체가 "1분마다 도는
// 트리거"가 아니라 "선생님 화면이 몇 초마다 상태를 물어볼 때마다 한 걸음 진행"으로 바뀐다
// (lib/ai/pipeline.ts의 tick 함수, Vercel 무료 플랜에는 1분 단위 크론이 없기 때문).

export const AI_API = "https://api.anthropic.com";
export const AI_VERSION = "2023-06-01";

export const AI_MODELS: Record<string, string> = {
  "claude-opus-5": "Claude Opus 5 (정확도 높음)",
  "claude-sonnet-5": "Claude Sonnet 5 (저렴)",
  "claude-fable-5-1": "Claude Fable 5.1 (가장 강력·고가)",
};
export const AI_DEFAULT_MODEL = "claude-opus-5";

// 100만 토큰당 달러 [입력, 출력]. 배치 API는 절반 할인.
const AI_PRICE: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-fable-5-1": [10, 50],
};

export function costOf(model: string, tokensIn: number, tokensOut: number): number {
  const p = AI_PRICE[model] ?? AI_PRICE[AI_DEFAULT_MODEL];
  return ((tokensIn * p[0] + tokensOut * p[1]) / 1e6) * 0.5;
}

export type AiCallResult = { status: number; text: string; json: any | null };

export class AiFatalError extends Error {
  fatal = true as const;
}

async function doFetch(url: string, init: RequestInit): Promise<AiCallResult> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 본문이 JSON이 아닐 수 있음(드묾) — text만 남긴다
  }
  return { status: resp.status, text, json };
}

/** 일반 JSON 호출. path가 https:// 로 시작하면 그대로, 아니면 AI_API를 붙인다. */
export async function anthropicCall(
  method: "get" | "post" | "delete",
  path: string,
  apiKey: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<AiCallResult> {
  const url = /^https:\/\//.test(path) ? path : AI_API + path;
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": AI_VERSION,
    ...extraHeaders,
  };
  const init: RequestInit = { method: method.toUpperCase(), headers };
  if (body != null) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return doFetch(url, init);
}

/** 시험지 PDF(Buffer)를 Anthropic Files API에 올린다. 실패하면(구버전 계정 등) files-api 베타
 *  헤더를 붙여 한 번 더 시도한다(Apps Script와 동일한 폴백). 성패 판단은 호출자(pipeline.ts)가
 *  aiUploadPdf 도우미로 한다 — 이 함수는 마지막 시도의 원본 결과만 돌려준다. */
export async function uploadPdfFile(apiKey: string, pdf: Buffer, filename = "exam.pdf"): Promise<AiCallResult> {
  async function attempt(withBeta: boolean) {
    const form = new FormData();
    // pdf as any: Buffer의 ArrayBufferLike가 SharedArrayBuffer를 포함하도록 넓어진 @types/node
    // 버전과 BlobPart 타입이 안 맞아 실제 빌드 실패가 있었음(ArrayBuffer/SharedArrayBuffer 불일치).
    form.append("file", new Blob([pdf as any], { type: "application/pdf" }), filename);
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": AI_VERSION,
    };
    if (withBeta) headers["anthropic-beta"] = "files-api-2025-04-14";
    return doFetch(AI_API + "/v1/files", { method: "POST", headers, body: form as any });
  }
  let r = await attempt(false);
  if (r.status === 401 || r.status === 403) return r;
  if (r.status >= 400) r = await attempt(true);
  return r;
}

export async function deleteFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await anthropicCall("delete", "/v1/files/" + fileId, apiKey);
  } catch {
    // 삭제 실패는 무시(용량이 조금 남는 정도, 치명적이지 않음)
  }
}

export type BatchRequest = { custom_id: string; params: Record<string, unknown> };

export async function createBatch(
  apiKey: string,
  requests: BatchRequest[]
): Promise<AiCallResult> {
  return anthropicCall("post", "/v1/messages/batches", apiKey, { requests });
}

export async function getBatch(apiKey: string, batchId: string): Promise<any> {
  const r = await anthropicCall("get", "/v1/messages/batches/" + batchId, apiKey);
  if (r.status === 401 || r.status === 403) throw new AiFatalError("API 키 인증 실패: " + aiErr(r));
  if (r.status >= 400 || !r.json) throw new Error("배치 상태를 확인하지 못했습니다: " + aiErr(r));
  return r.json;
}

export async function cancelBatch(apiKey: string, batchId: string): Promise<void> {
  try {
    await anthropicCall("post", "/v1/messages/batches/" + batchId + "/cancel", apiKey, {});
  } catch {
    // 취소 실패는 무시 — 곧 자연 만료됨
  }
}

/** 끝난 배치의 결과줄(NDJSON)을 { custom_id: 결과줄 } 로 파싱 */
export async function getBatchResults(apiKey: string, batch: any): Promise<Record<string, any>> {
  const url = batch.results_url || AI_API + "/v1/messages/batches/" + batch.id + "/results";
  const r = await anthropicCall("get", url, apiKey);
  if (r.status >= 400) throw new Error("배치 결과를 가져오지 못했습니다: " + aiErr(r));
  const out: Record<string, any> = {};
  for (const raw of r.text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      out[o.custom_id] = o;
    } catch {
      // 손상된 줄은 건너뜀
    }
  }
  return out;
}

export function aiErr(r: AiCallResult | null): string {
  const m = r?.json?.error?.message;
  return "HTTP " + (r ? r.status : "?") + (m ? " " + String(m).slice(0, 300) : "");
}

/** 배치 결과 한 줄에서 지정한 이름의 tool_use 입력을 꺼낸다. 실패/거부/도구 미사용이면 null. */
export function toolInputOf(line: any, toolName: string): any | null {
  const message = line?.result?.type === "succeeded" ? line.result.message : null;
  if (!message?.content) return null;
  for (const c of message.content) {
    if (c?.type === "tool_use" && c.name === toolName && c.input && typeof c.input === "object") {
      return c.input;
    }
  }
  return null;
}

export function failWhy(line: any): string {
  if (!line) return "결과 없음";
  const r = line.result || {};
  if (r.type === "succeeded") return "도구 결과 없음(" + (r.message?.stop_reason ?? "?") + ")";
  if (r.type === "errored") return r.error?.error?.message || r.error?.message || "오류";
  return r.type || "알 수 없음";
}

export type UsageAcc = { i: number; o: number };

/** 배치 결과 한 줄의 토큰 사용량을 usage 누적 객체(state.usage)에 더한다. 반환값은 이번 호출로
 *  새로 늘어난 토큰 수(delta) — 호출자가 이 값으로 ai_usage 장부(recordUsage)를 갱신한다. */
export function addUsage(usage: UsageAcc, line: any): { di: number; dO: number } | null {
  const message = line?.result?.type === "succeeded" ? line.result.message : null;
  const u = message?.usage;
  if (!u) return null;
  const di = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const dO = u.output_tokens || 0;
  usage.i += di;
  usage.o += dO;
  return { di, dO };
}

/** 크레딧 부족/사용 한도 오류인지 판별 (Apps Script aiCreditKind_) */
export function aiCreditKind(r: AiCallResult | null): "" | "credit" | "limit" {
  if (!r || ![400, 402, 403, 429].includes(r.status)) return "";
  const m = String(r.json?.error?.message || r.text || "");
  if (/credit balance|purchase credits|insufficient (?:credit|funds)/i.test(m)) return "credit";
  if (/usage limits?|spend(?:ing)? limit|reached your (?:specified|monthly)/i.test(m)) return "limit";
  return "";
}
