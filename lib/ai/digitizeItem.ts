import "server-only";
import { adaptParamsForModel, aiCreditKind, aiErr, anthropicCall } from "./anthropic";
import { DG_ITEM_TOOL, dgItemPrompt } from "./prompts";
import { clearLowBalanceAlert, getAiCreds, recordLowBalanceAlert, recordUsage } from "./settings";
import { cleanItemText, textOf, type ItemText } from "@/lib/digitize/itemEdit";

// 디지털화된 문항 하나만 AI에게 다시 읽힌다(2026-09-30 원장님 요청).
// 쪽 전체를 배치로 다시 돌리면 10~40분 걸리고 다른 문항(직접 고친 것 포함)까지 바뀌므로, 이 문항 하나만 바로(배치 없이) 묻는다.
// 그림은 브라우저가 스캔본 쪽을 그려서 보낸다(쪽 전체 + 확대 그림) — 숫자를 잘못 읽는 건 대개 해상도 탓이라 확대 그림이 핵심.
// 결과는 저장하지 않고 돌려준다: 화면에서 원장님이 바뀐 곳을 보고 "덮어쓰기"를 눌러야 저장된다(saveDigitizedItem).

type Client = any;

export type RedoImages = { page: string; zooms: string[]; zoom: "box" | "halves" }; // base64 JPEG(머리말 data: 없이)

const TIMEOUT_MS = 50_000; // 이 라우트 실행 시간(60초) 안에 끝내기

function img(b64: string) {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } };
}

/** 지금 옮겨 적은 내용을 AI에게 보여 줄 글로 */
function describe(t: ItemText): string {
  const parts = [`번호: ${t.label || "(없음)"}`, `배점: ${t.points ?? "(없음)"}`, `문제 글:\n${t.stem}`];
  if (t.box_lines.length) parts.push(`${t.box_title || "상자"}:\n${t.box_lines.join("\n")}`);
  if (t.choices.length) parts.push(`선택지:\n${t.choices.map((c, i) => `${"①②③④⑤⑥⑦⑧"[i] ?? i + 1} ${c}`).join("\n")}`);
  return parts.join("\n");
}

export async function redigitizeItem(
  client: Client,
  opts: { pageNo: number; item: any; images: RedoImages; hint: string }
): Promise<{ ok: true; text: ItemText; changes: string } | { ok: false; msg: string }> {
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) return { ok: false, msg: "AI API 키가 아직 저장되지 않았습니다. AI 설정에서 키를 먼저 저장해 주세요." };
  const cur = textOf(opts.item);
  const prompt = dgItemPrompt({
    label: cur.label || "?",
    pageNo: opts.pageNo,
    current: describe(cur),
    hint: String(opts.hint ?? "").slice(0, 500),
    zoom: opts.images.zoom,
  });
  const params = adaptParamsForModel({
    model,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" }, // 빨리 끝나야 한다(한 문항 옮겨 적기라 깊이 생각할 일이 적음)
    tools: [DG_ITEM_TOOL],
    tool_choice: { type: "tool", name: DG_ITEM_TOOL.name },
    messages: [{ role: "user", content: [img(opts.images.page), ...opts.images.zooms.map(img), { type: "text", text: prompt }] }],
  });

  let r;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    r = await Promise.race([
      anthropicCall("post", "/v1/messages", apiKey, params),
      new Promise<never>((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("timeout")))),
    ]);
  } catch (e: any) {
    return {
      ok: false,
      msg:
        String(e?.message) === "timeout"
          ? "AI가 50초 안에 끝내지 못했습니다. 한 번 더 눌러 보시고, 계속 그러면 문항 자리를 네모로 좁게 지정해 주세요."
          : "AI에 묻지 못했습니다: " + String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }

  const kind = aiCreditKind(r);
  if (kind) {
    await recordLowBalanceAlert(client, kind, String(r.json?.error?.message || r.text || "").slice(0, 300)).catch(() => undefined);
    return { ok: false, msg: kind === "credit" ? "Anthropic 크레딧이 부족합니다. 충전한 뒤 다시 눌러 주세요." : "Anthropic API 사용 한도에 도달했습니다." };
  }
  if (r.status !== 200 || !r.json) return { ok: false, msg: "AI 요청 실패: " + aiErr(r) };
  await clearLowBalanceAlert(client).catch(() => undefined);

  // 사용량 기록 — 배치가 아닌 바로 호출이라 값이 두 배(recordUsage는 배치 반값으로 계산하므로 토큰을 두 배로 넘긴다)
  const u = r.json.usage ?? {};
  const di = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const dO = u.output_tokens || 0;
  await recordUsage(client, model, di * 2, dO * 2).catch(() => undefined);

  const use = ((r.json.content as any[]) ?? []).find((c) => c?.type === "tool_use" && c.name === DG_ITEM_TOOL.name);
  if (!use?.input) return { ok: false, msg: "AI가 결과를 도구로 내지 않았습니다. 한 번 더 눌러 주세요." };
  // 번호는 AI가 다르게 읽어도 지금 번호를 유지(다른 문항을 읽었을 수 있어 아래에서 확인)
  const cleaned = cleanItemText({ ...use.input, box_title: use.input.box_title ?? "", box_lines: use.input.box_lines ?? [] });
  if (!cleaned.ok) return { ok: false, msg: "AI 결과를 쓸 수 없습니다: " + cleaned.msg };
  const text = cleaned.text;
  const norm = (s: string) => s.replace(/[\s.번]/g, "");
  let changes = String(use.input.changes ?? "").slice(0, 300);
  if (cur.label && text.label && norm(cur.label) !== norm(text.label)) {
    changes = `주의: AI가 ${text.label}번을 읽었습니다(지금은 ${cur.label}번). 다른 문항을 읽었을 수 있으니 확인해 주세요. ` + changes;
    text.label = cur.label;
  }
  if (!text.label) text.label = cur.label;
  return { ok: true, text, changes };
}
