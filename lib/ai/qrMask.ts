import "server-only";
import { addUsage, aiCreditKind, aiErr, createBatch, failWhy, getBatch, getBatchResults, toolInputOf } from "./anthropic";
import { autoBbox } from "./normalize";
import { getExamPdfBuffer, getExamPdfMeta } from "./pdf";
import { fetchAllPages } from "@/lib/supabase/fetchAll";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearLowBalanceAlert, getAiCreds, recordLowBalanceAlert, recordUsage } from "./settings";

// 원본 시험지 쪽 안의 QR 코드 가리기 — 2026-09-29 원장님 요청.
//
// 시험지 원본에 인쇄된 QR(학교 해설 QR, 다른 학원·출처 사이트 QR 등)을 AI로 찾아 exam_qr_scans(0031)에 저장하고,
// 학생·과외선생님용 PDF를 만들 때(lib/ai/pdfStamp.ts) 그 자리를 흰 사각형으로 덮는다. 원본 파일은 그대로 둔다.
// 진행 방식은 문항 영역 찾기(lib/ai/locate.ts)와 같다: 시험 하나당 요청 하나를 Message Batches로 보내고,
// 크론(/api/ai/cron-tick)이 tickQrScans를 부를 때마다 결과를 확인한다. 테이블이 없으면(0031 전) 조용히 아무것도 안 한다.

type Client = any;
const TABLE = "exam_qr_scans";

export type QrBox = { page: number; x0: number; y0: number; x1: number; y1: number };

export const QR_TOOL = {
  name: "report_qr_codes",
  description: "시험지 PDF의 각 쪽에 인쇄된 QR 코드의 위치를 모두 제출한다. 없으면 빈 목록.",
  input_schema: {
    type: "object",
    properties: {
      qrs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page: { type: "integer", description: "QR이 있는 쪽(PDF 1쪽부터 센 번호)" },
            bbox: {
              type: "object",
              description: "그 쪽을 가로세로 1000칸으로 나눈 좌표로 본 QR 코드 영역(왼쪽 위가 0,0)",
              properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } },
              required: ["x0", "y0", "x1", "y1"],
            },
          },
          required: ["page", "bbox"],
        },
      },
    },
    required: ["qrs"],
  },
};

const QR_PROMPT = [
  "첨부한 시험지 PDF의 모든 쪽을 처음부터 끝까지 보고, 쪽 안에 인쇄된 QR 코드(검은 사각 점들로 된 정사각형 2차원 코드)를 빠짐없이 찾아 report_qr_codes 도구로 제출하세요.",
  "- page: QR이 있는 쪽 번호(PDF 1쪽부터).",
  "- bbox: 그 쪽을 가로 1000 × 세로 1000 칸으로 나눴을 때 QR 코드 전체를 감싸는 사각형. 왼쪽 위가 (0,0), 오른쪽 아래가 (1000,1000). x0,y0 = 왼쪽 위, x1,y1 = 오른쪽 아래. 네 귀퉁이의 큰 사각 표식까지 모두 들어가게 잡으세요.",
  "- 한 쪽에 QR이 여러 개면 각각 따로 적으세요. 쪽이 가로로 돌아가 있으면, 보이는 방향(똑바로 세워 읽는 방향) 기준으로 좌표를 잡으세요.",
  "- QR 코드만 적습니다. 학교 로고·도장·그림·그래프·표·일반 바코드·문제 번호 상자는 적지 않습니다.",
  "- QR이 하나도 없으면 qrs를 빈 목록으로 제출하세요.",
].join("\n");

function kstTime(d = new Date()): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** 원본 PDF가 바뀌었는지 알아보기 위한 표시(저장 경로·올린 시각·쪽 수·디지털 적용 여부) */
export function pdfKeyOf(meta: any): string | null {
  if (!meta?.storage_path) return null;
  return [meta.storage_path, meta.uploaded_at ?? "", meta.pages ?? "", meta.replaced_with_digitized ? "d" : ""].join("|");
}

async function setScan(client: Client, examId: string, patch: Record<string, unknown>): Promise<void> {
  await (client.from(TABLE) as any).update({ ...patch, updated_at: new Date().toISOString() }).eq("exam_id", examId);
}

/** 이 시험의 QR 찾기를 (다시) 건다. 이미 진행 중이면 그대로 둔다. 0031 전이면 조용히 아무것도 안 함. */
export async function enqueueQrScan(_client: Client, examId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  // 이 표는 서비스롤만 쓸 수 있으므로(0031), 어디서 부르든 서버의 서비스롤 클라이언트로 쓴다.
  const client = createAdminClient() as any;
  try {
    const { data: cur, error } = (await (client.from(TABLE) as any)
      .select("stage, pdf_key")
      .eq("exam_id", examId)
      .maybeSingle()) as any;
    if (error) return false;
    if (cur && (cur.stage === "submit" || cur.stage === "wait")) return false;
    if (cur && cur.stage === "done" && !opts.force) {
      const meta = await getExamPdfMeta(client, examId).catch(() => null);
      if (cur.pdf_key && cur.pdf_key === pdfKeyOf(meta)) return false; // 같은 PDF를 이미 찾음
    }
    const row = { exam_id: examId, stage: "submit", batch_id: null, attempts: 0, message: "QR 찾기 대기 중…", updated_at: new Date().toISOString() };
    const { error: uErr } = await (client.from(TABLE) as any).upsert(row, { onConflict: "exam_id" });
    return !uErr;
  } catch {
    return false;
  }
}

/** PDF가 있는데 아직 QR을 안 찾았거나(또는 PDF가 바뀌었거나) 오류로 멈춘 시험을 모두 건다. 건 시험 수. */
export async function enqueueAllQrScans(client: Client): Promise<number> {
  const [{ data: metas }, { data: scans, error }] = await Promise.all([
    fetchAllPages((f: number, t: number) => client.from("exam_pdf_meta").select("*").order("exam_id").range(f, t)),
    fetchAllPages((f: number, t: number) => (client.from(TABLE) as any).select("exam_id, stage, pdf_key").order("exam_id").range(f, t)),
  ]);
  if (error) return 0;
  const scanBy = new Map(((scans as any[]) ?? []).map((s) => [s.exam_id, s]));
  let n = 0;
  for (const m of (metas as any[]) ?? []) {
    const s = scanBy.get(m.exam_id);
    const need = !s || s.stage === "error" || (s.stage === "done" && s.pdf_key !== pdfKeyOf(m));
    if (need && (await enqueueQrScan(client, m.exam_id, { force: true }))) n++;
  }
  return n;
}

/**
 * PDF를 만들 때 쓸 QR 위치. 지금 원본 PDF를 대상으로 찾은 결과(done)일 때만 돌려준다 — PDF가 바뀌었으면 옛 위치로
 * 엉뚱한 곳을 가리지 않도록 빈 배열 + 다시 찾기를 건다. status는 화면 안내용.
 */
export async function getQrBoxes(
  client: Client,
  examId: string
): Promise<{ status: "none" | "pending" | "done" | "error" | "stale" | "unavailable"; boxes: QrBox[]; message: string }> {
  try {
    const { data: s, error } = (await (client.from(TABLE) as any)
      .select("stage, boxes, pdf_key, message")
      .eq("exam_id", examId)
      .maybeSingle()) as any;
    if (error) return { status: "unavailable", boxes: [], message: "" };
    if (!s) return { status: "none", boxes: [], message: "" };
    if (s.stage === "submit" || s.stage === "wait") return { status: "pending", boxes: [], message: s.message ?? "" };
    if (s.stage === "error") return { status: "error", boxes: [], message: s.message ?? "" };
    const meta = await getExamPdfMeta(client, examId).catch(() => null);
    if (s.pdf_key && s.pdf_key !== pdfKeyOf(meta)) return { status: "stale", boxes: [], message: "" };
    const boxes = (Array.isArray(s.boxes) ? s.boxes : []).filter(
      (b: any) => b && Number.isInteger(b.page) && [b.x0, b.y0, b.x1, b.y1].every((v: any) => Number.isFinite(v))
    );
    return { status: "done", boxes, message: s.message ?? "" };
  } catch {
    return { status: "unavailable", boxes: [], message: "" };
  }
}

/** AI가 준 좌표를 정리: 쪽 번호 확인, 너무 크거나(쪽의 1/6 넘게) 길쭉한 것은 QR이 아니라고 보고 버림, 가장자리 여유 조금 */
export function cleanQrBoxes(raw: any[], totalPages: number | null): QrBox[] {
  const out: QrBox[] = [];
  for (const q of raw ?? []) {
    const page = Math.round(Number(q?.page));
    const b = autoBbox(q?.bbox);
    if (!b || !(page >= 1) || (totalPages && page > totalPages)) continue;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    if (w < 8 || h < 8) continue; // 점처럼 작은 것
    if (w * h > (1000 * 1000) / 6) continue; // 쪽의 1/6보다 큰 영역은 QR일 리 없음
    const ratio = w / h;
    if (ratio < 0.4 || ratio > 2.5) continue; // QR은 대략 정사각형
    const pad = Math.max(10, Math.round(Math.max(w, h) * 0.12)); // AI 좌표가 조금 어긋나도 다 덮이게 넉넉히
    out.push({
      page,
      x0: Math.max(0, b.x0 - pad),
      y0: Math.max(0, b.y0 - pad),
      x1: Math.min(1000, b.x1 + pad),
      y1: Math.min(1000, b.y1 + pad),
    });
  }
  return out;
}

async function stepSubmit(client: Client, job: any): Promise<void> {
  const examId: string = job.exam_id;
  const meta = await getExamPdfMeta(client, examId).catch(() => null);
  if (!meta) {
    await setScan(client, examId, { stage: "done", boxes: [], pdf_key: null, message: "시험지 PDF가 없습니다." });
    return;
  }
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) {
    await setScan(client, examId, { stage: "error", message: "AI API 키가 없습니다. AI 설정에서 먼저 저장해 주세요." });
    return;
  }
  const buf = await getExamPdfBuffer(client, examId);
  const doc = { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
  const r = await createBatch(apiKey, [
    {
      custom_id: "qr",
      params: {
        model,
        max_tokens: 4000,
        tools: [QR_TOOL],
        tool_choice: { type: "tool", name: QR_TOOL.name },
        messages: [{ role: "user", content: [doc, { type: "text", text: QR_PROMPT }] }],
      },
    },
  ]);
  const kind = aiCreditKind(r);
  if (kind) {
    await recordLowBalanceAlert(client, kind, String(r.json?.error?.message || r.text || "").slice(0, 300));
    await setScan(client, examId, {
      stage: "error",
      message: kind === "credit" ? "Anthropic 크레딧이 부족합니다. 충전 후 다시 시도해 주세요." : "Anthropic 사용 한도에 도달했습니다.",
    });
    return;
  }
  if (r.status !== 200 || !r.json?.id) {
    const attempts = (job.attempts ?? 0) + 1;
    await setScan(client, examId, { stage: attempts >= 3 ? "error" : "submit", attempts, message: "AI 요청 실패: " + aiErr(r) });
    return;
  }
  await clearLowBalanceAlert(client);
  await setScan(client, examId, {
    stage: "wait",
    batch_id: r.json.id,
    attempts: 0,
    pdf_key: pdfKeyOf(meta),
    message: `QR을 찾는 중… (${kstTime()} AI에 보냄 · 보통 수 분)`,
  });
}

async function stepWait(client: Client, job: any): Promise<void> {
  const examId: string = job.exam_id;
  const { apiKey, model } = await getAiCreds(client);
  if (!apiKey) {
    await setScan(client, examId, { stage: "error", message: "AI API 키가 없습니다." });
    return;
  }
  const b = await getBatch(apiKey, job.batch_id);
  if (b.processing_status !== "ended") {
    await setScan(client, examId, {});
    return;
  }
  const results = await getBatchResults(apiKey, b);
  const line = results["qr"];
  const delta = addUsage({ i: 0, o: 0 }, line);
  if (delta) await recordUsage(client, model, delta.di, delta.dO);
  const input = toolInputOf(line, QR_TOOL.name);
  if (!input || !Array.isArray(input.qrs)) {
    const attempts = (job.attempts ?? 0) + 1;
    await setScan(client, examId, {
      stage: attempts >= 2 ? "error" : "submit",
      attempts,
      batch_id: null,
      message: "AI가 결과를 돌려주지 않았습니다: " + failWhy(line).slice(0, 150),
    });
    return;
  }
  const meta = await getExamPdfMeta(client, examId).catch(() => null);
  const boxes = cleanQrBoxes(input.qrs, typeof meta?.pages === "number" ? meta.pages : null);
  const pages = Array.from(new Set(boxes.map((q) => q.page))).sort((a, c) => a - c);
  await setScan(client, examId, {
    stage: "done",
    batch_id: null,
    attempts: 0,
    boxes,
    message: boxes.length ? `QR ${boxes.length}개를 찾았습니다(${pages.join(", ")}쪽).` : "QR이 없습니다.",
  });
}

async function claimScan(client: Client, job: any): Promise<boolean> {
  if (!job.updated_at) return true;
  const { data, error } = (await (client.from(TABLE) as any)
    .update({ updated_at: new Date().toISOString() })
    .eq("exam_id", job.exam_id)
    .eq("stage", job.stage)
    .eq("updated_at", job.updated_at)
    .select("exam_id")) as any;
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

const SUBMIT_MIN_MS = 15_000;
const WAIT_MIN_MS = 4_000;
const CONCURRENCY = 3;

/** 진행 중인 QR 찾기를 한 걸음씩 진행한다(deadline 안에서만). 처리한 작업 수. 0031 전이면 0. */
export async function tickQrScans(client: Client, deadline: number): Promise<number> {
  const { data: jobs, error } = (await (client.from(TABLE) as any)
    .select("exam_id, stage, batch_id, attempts, updated_at")
    .in("stage", ["submit", "wait"])
    .order("updated_at", { ascending: true })
    .limit(30)) as any;
  if (error) return 0;
  const queue: any[] = [...((jobs as any[]) ?? [])];
  let n = 0;
  async function runOne(job: any) {
    if (!(await claimScan(client, job))) return;
    try {
      if (job.stage === "submit") await stepSubmit(client, job);
      else if (job.batch_id) await stepWait(client, job);
      else await setScan(client, job.exam_id, { stage: "submit", batch_id: null });
      n++;
    } catch (e: any) {
      const attempts = (job.attempts ?? 0) + 1;
      await setScan(client, job.exam_id, {
        stage: attempts >= 5 ? "error" : job.stage,
        attempts,
        message: "일시 오류(다시 시도함): " + String(e?.message || e).slice(0, 200),
      }).catch(() => {});
    }
  }
  async function worker() {
    for (;;) {
      const left = deadline - Date.now();
      const i = queue.findIndex((j) => left >= (j.stage === "submit" ? SUBMIT_MIN_MS : WAIT_MIN_MS));
      if (i < 0) return;
      const [job] = queue.splice(i, 1);
      await runOne(job);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return n;
}

/** AI 설정 화면용 요약 */
export async function getQrScanSummary(client: Client): Promise<{
  available: boolean;
  pdfExams: number;
  done: number;
  withQr: number;
  qrCount: number;
  pending: number;
  error: number;
  notScanned: number;
}> {
  const [{ data: metas }, { data: scans, error }] = await Promise.all([
    fetchAllPages((f: number, t: number) => client.from("exam_pdf_meta").select("*").order("exam_id").range(f, t)),
    fetchAllPages((f: number, t: number) => (client.from(TABLE) as any).select("exam_id, stage, boxes, pdf_key").order("exam_id").range(f, t)),
  ]);
  const empty = { available: false, pdfExams: 0, done: 0, withQr: 0, qrCount: 0, pending: 0, error: 0, notScanned: 0 };
  if (error) return empty;
  const scanBy = new Map(((scans as any[]) ?? []).map((s) => [s.exam_id, s]));
  const out = { ...empty, available: true };
  for (const m of (metas as any[]) ?? []) {
    out.pdfExams++;
    const s = scanBy.get(m.exam_id);
    if (!s) out.notScanned++;
    else if (s.stage === "submit" || s.stage === "wait") out.pending++;
    else if (s.stage === "error") out.error++;
    else if (s.pdf_key && s.pdf_key !== pdfKeyOf(m)) out.notScanned++;
    else {
      out.done++;
      const k = Array.isArray(s.boxes) ? s.boxes.length : 0;
      if (k) {
        out.withQr++;
        out.qrCount += k;
      }
    }
  }
  return out;
}
