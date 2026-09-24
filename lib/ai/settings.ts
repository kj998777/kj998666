import "server-only";
import { AI_DEFAULT_MODEL, AI_MODELS, anthropicCall, costOf } from "./anthropic";

// AI 설정(모델·API 키)과 크레딧 장부. Apps Script의 teacherAutoSettings/teacherAutoSaveSettings/
// teacherAiCredit/teacherAiBalanceSave 를 그대로 포팅. ai_settings·ai_usage 는 항상 정확히 한 행만
// 있는 "설정 테이블"이라(마이그레이션에서 미리 넣어 둠) upsert 없이 update만 하면 된다.
//
// (as any 캐스팅 이유는 lib/ai/job.ts 상단 주석 참고 — 이 프로젝트의 손으로 쓴 타입 + supabase-js
// 조합에서 겪은 실제 빌드 실패 때문에 쓰기 계열 호출은 전부 빌더를 캐스팅한다.)
//
// Client 타입은 일부러 any로 둔다: lib/supabase/server.ts의 createClient()는 @supabase/ssr의
// createServerClient<Database>()를 쓰는데, 이게 돌려주는 타입이 @supabase/supabase-js의
// SupabaseClient<Database>와 구조적으로는 거의 같아도 두 패키지가 내부적으로 서로 다른 타입
// 인스턴스를 만들어내서(중복 설치된 supabase-js 사본 문제로 추정) 대입이 안 되는 실제 빌드 실패를
// 겪었다. 이 프로젝트는 어차피 쓰기 호출마다 as any를 쓰고 있어서, 클라이언트 타입 자체를 느슨하게
// 두는 쪽이 더 간단하고 안전하다.
type Client = any;

const BILLING_URL = "https://platform.claude.com/settings/billing";

export type AiSettingsPublic = {
  hasKey: boolean;
  tail: string;
  model: string;
  models: { id: string; name: string }[];
};

export async function getAiSettingsPublic(client: Client): Promise<AiSettingsPublic> {
  const { data, error } = (await client.from("ai_settings").select("model, api_key").eq("id", true).single()) as any;
  if (error) throw error;
  const key = data.api_key || "";
  return {
    hasKey: !!key,
    tail: key ? key.slice(-4) : "",
    model: AI_MODELS[data.model] ? data.model : AI_DEFAULT_MODEL,
    models: Object.entries(AI_MODELS).map(([id, name]) => ({ id, name })),
  };
}

/** 내부용: 실제 호출에 쓸 키·모델을 가져온다(키가 없으면 null) */
export async function getAiCreds(client: Client): Promise<{ apiKey: string | null; model: string }> {
  const { data, error } = (await client.from("ai_settings").select("model, api_key").eq("id", true).single()) as any;
  if (error) throw error;
  return { apiKey: data.api_key || null, model: AI_MODELS[data.model] ? data.model : AI_DEFAULT_MODEL };
}

export type SaveSettingsResult = { ok: true; settings: AiSettingsPublic } | { ok: false; msg: string };

/** key가 비어 있으면 키는 그대로 두고 모델만 바꾼다. 새 키는 저장 전에 API로 한 번 확인한다. */
export async function saveAiSettings(
  client: Client,
  key: string | undefined,
  model: string | undefined
): Promise<SaveSettingsResult> {
  const trimmed = (key || "").trim();
  const update: { api_key?: string; model?: string } = {};
  if (trimmed) {
    if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(trimmed)) {
      return { ok: false, msg: "API 키 형식이 올바르지 않습니다(sk-ant- 로 시작하는 키)." };
    }
    const r = await anthropicCall("get", "/v1/models?limit=1", trimmed);
    if (r.status === 401 || r.status === 403) {
      return { ok: false, msg: "이 API 키는 사용할 수 없습니다(인증 실패). 키를 다시 확인해 주세요." };
    }
    if (r.status >= 400) {
      return { ok: false, msg: "API 키를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    update.api_key = trimmed;
  }
  if (model && AI_MODELS[model]) update.model = model;
  if (Object.keys(update).length) {
    const { error } = await (client.from("ai_settings") as any).update(update).eq("id", true);
    if (error) throw error;
  }
  return { ok: true, settings: await getAiSettingsPublic(client) };
}

export async function clearAiKey(client: Client): Promise<AiSettingsPublic> {
  const { error } = await (client.from("ai_settings") as any).update({ api_key: null }).eq("id", true);
  if (error) throw error;
  return getAiSettingsPublic(client);
}

// ---- 크레딧 장부 ----

export async function recordUsage(client: Client, model: string, tokensIn: number, tokensOut: number): Promise<void> {
  if (!tokensIn && !tokensOut) return;
  const usd = costOf(model, tokensIn, tokensOut);
  const { data, error } = (await client
    .from("ai_usage")
    .select("spent_usd, tokens_in, tokens_out")
    .eq("id", true)
    .single()) as any;
  if (error) throw error;
  const { error: upErr } = await (client.from("ai_usage") as any)
    .update({
      spent_usd: Math.round((data.spent_usd + usd) * 10000) / 10000,
      tokens_in: data.tokens_in + tokensIn,
      tokens_out: data.tokens_out + tokensOut,
    })
    .eq("id", true);
  if (upErr) throw upErr;
}

export async function recordLowBalanceAlert(client: Client, kind: "credit" | "limit", message: string): Promise<void> {
  await (client.from("ai_usage") as any)
    .update({ low_alert_at: new Date().toISOString(), low_alert_kind: kind, low_alert_message: message.slice(0, 300) })
    .eq("id", true);
}

export async function clearLowBalanceAlert(client: Client): Promise<void> {
  await (client.from("ai_usage") as any)
    .update({ low_alert_at: null, low_alert_kind: null, low_alert_message: null })
    .eq("id", true);
}

export type CreditInfo = {
  ok: true;
  url: string;
  spent: number;
  tokIn: number;
  tokOut: number;
  since: string;
  exams: number;
  avg: number;
  model: string;
  bal: {
    usd: number;
    at: string | null;
    used: number;
    est: number;
    exams: number | null;
    tokens: number | null;
  } | null;
  low: { at: string; kind: "credit" | "limit"; message: string } | null;
};

export async function getCreditInfo(client: Client): Promise<CreditInfo> {
  const { data: usage, error } = (await client.from("ai_usage").select("*").eq("id", true).single()) as any;
  if (error) throw error;
  const { model } = await getAiCreds(client);

  // 확정(review/done)된 시험들의 시험당 평균 비용 — exam_jobs.state.usage 를 모아 계산
  const { data: jobs } = (await client.from("exam_jobs").select("stage, state").in("stage", ["review", "done"])) as any;
  const per: number[] = [];
  for (const j of jobs || []) {
    const u = j.state?.usage;
    const m = j.state?.model || model;
    if (u) per.push(costOf(m, u.i || 0, u.o || 0));
  }
  per.sort((a, b) => a - b);
  const avg = per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0;

  const out: CreditInfo = {
    ok: true,
    url: BILLING_URL,
    spent: usage.spent_usd,
    tokIn: usage.tokens_in,
    tokOut: usage.tokens_out,
    since: usage.since,
    exams: per.length,
    avg: Math.round(avg * 10000) / 10000,
    model,
    bal: null,
    low:
      usage.low_alert_at && usage.low_alert_kind
        ? { at: usage.low_alert_at, kind: usage.low_alert_kind, message: usage.low_alert_message || "" }
        : null,
  };
  if (usage.balance_usd != null && isFinite(usage.balance_usd)) {
    const used = Math.max(0, Math.round((usage.spent_usd - (usage.balance_spent_at_record || 0)) * 10000) / 10000);
    const est = Math.round((usage.balance_usd - used) * 10000) / 10000;
    const tt = usage.tokens_in + usage.tokens_out;
    out.bal = {
      usd: usage.balance_usd,
      at: usage.balance_recorded_at,
      used,
      est,
      exams: avg > 0 ? Math.max(0, Math.floor(est / avg)) : null,
      tokens: usage.spent_usd > 0 && tt > 0 && est > 0 ? Math.round(est / (usage.spent_usd / tt)) : null,
    };
  }
  return out;
}

export async function saveBalance(client: Client, usdRaw: string): Promise<{ ok: true } | { ok: false; msg: string }> {
  const raw = String(usdRaw ?? "").replace(/[$,\s]/g, "");
  const v = raw === "" ? NaN : Number(raw);
  if (!isFinite(v) || v < 0 || v > 1000000) {
    return { ok: false, msg: "잔액은 0 이상의 숫자(달러)로 적어 주세요. 예: 23.45" };
  }
  const { data, error } = (await client.from("ai_usage").select("spent_usd").eq("id", true).single()) as any;
  if (error) throw error;
  const { error: upErr } = await (client.from("ai_usage") as any)
    .update({
      balance_usd: Math.round(v * 100) / 100,
      balance_recorded_at: new Date().toISOString(),
      balance_spent_at_record: data.spent_usd,
      low_alert_at: null,
      low_alert_kind: null,
      low_alert_message: null,
    })
    .eq("id", true);
  if (upErr) throw upErr;
  return { ok: true };
}

export async function clearBalance(client: Client): Promise<void> {
  await (client.from("ai_usage") as any)
    .update({ balance_usd: null, balance_recorded_at: null, balance_spent_at_record: null })
    .eq("id", true);
}
