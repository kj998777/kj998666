"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guessFolder } from "@/lib/exams/guessFolder";
import { readMockAnswersFromPdf } from "@/lib/ai/mockAnswers";
import { buildKeyRows, cleanGradeCuts, cleanPageMap, type CsatAnswers, type GradeCuts, type PageMap } from "@/lib/exams/mockCsat";
import { regradeExam } from "@/lib/review/regrade";
import { cleanGichulInput, parseGichulImport, type GichulLink } from "@/lib/exams/gichulLinks";

// 고3 사설 모의고사(0053 exams.mock_csat) — 2026-10-11 원장님 "디지털화·해설 작성 없이 문제지·해설지를 내가 둘 다 올리게".
// 흐름: createMockExam(행) → 브라우저가 문제지(exam-pdfs/<id>/<시각>.pdf)·해설지(exam-pdfs/_solutions/<id>/<시각>.pdf)를
// Storage에 직접 올림 → finalizeAttachExamPdfOnly(문제지, AI 처리 없음) + finalizeSolutionPdf(해설지) → 시험 화면에서
// readMockAnswers(해설지에서 AI가 정답만 읽어 표에 채움) → 원장님 확인 → saveMockKey(정답표 저장, 제출이 있으면 다시 채점).

const BUCKET = "exam-pdfs";

type Res<T = {}> = ({ ok: true } & T) | { ok: false; msg: string };

async function examByCode(code: string) {
  const supabase = await createClient();
  const { data } = (await (supabase.from("exams") as any).select("id, code, name, status, mock_csat, solution_pdf_path").eq("code", code).maybeSingle()) as any;
  return data as { id: string; code: string; name: string; status: string; mock_csat: boolean; solution_pdf_path: string | null } | null;
}

function autoCode(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // 한국 시각
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, "");
  return `mock${ymd}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 새 고3 사설 모의고사 행만 만든다(닫힘·고3). 코드를 비우면 자동으로 만든다. */
export async function createMockExam(formData: FormData): Promise<Res<{ id: string; code: string }>> {
  const { userId } = await requireRole("editor");
  const name = String(formData.get("name") ?? "").normalize("NFC").trim();
  const code = String(formData.get("code") ?? "").normalize("NFC").trim() || autoCode();
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };
  if (code.length > 80) return { ok: false, msg: "시험 코드가 너무 깁니다." };
  const g = guessFolder(name, code);
  const supabase = await createClient();
  const { data, error } = (await (supabase.from("exams") as any)
    .insert({
      code,
      name,
      status: "닫힘",
      created_by: userId,
      mock_csat: true,
      ...g,
      // 2026-10-11 원장님 "2027학년도라 2026 → 고3 → 모의고사"(0056): 연도는 이름의 "N학년도" − 1(guessFolder), 없으면 올해
      school_level: "고",
      folder_year: g.folder_year ?? String(new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear()),
      folder_grade: g.folder_grade ?? 3,
      folder_term: null,
      folder_kind: "모의고사",
    })
    .select("id, code")
    .single()) as any;
  if (error) {
    const msg = error.code === "23505" ? "이미 사용 중인 시험 코드입니다." : "만들지 못했습니다: " + error.message;
    return { ok: false, msg };
  }
  revalidatePath("/exams");
  return { ok: true, id: data.id, code: data.code };
}

/** 브라우저가 방금 올린 해설지 PDF를 시험에 연결하고, 예전 해설지 파일은 지운다. */
export async function finalizeSolutionPdf(code: string, path: string): Promise<Res> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const prefix = `_solutions/${exam.id}/`;
  if (!String(path).startsWith(prefix) || !/^\d+\.pdf$/.test(String(path).slice(prefix.length))) return { ok: false, msg: "해설지 경로가 올바르지 않습니다." };
  const admin = createAdminClient();
  // 해설지가 바뀌면 예전 쪽 지도(0054)는 맞지 않으므로 지운다 — 시험 화면이 새로 찾는다
  const { error } = await (admin.from("exams") as any).update({ solution_pdf_path: path, solution_page_map: null }).eq("id", exam.id);
  if (error) return { ok: false, msg: "해설지를 연결하지 못했습니다: " + error.message };
  try {
    const { data: files } = await admin.storage.from(BUCKET).list(`_solutions/${exam.id}`, { limit: 100 });
    const old = ((files as any[]) ?? []).map((f) => `${prefix}${f.name}`).filter((p) => p !== path);
    if (old.length) await admin.storage.from(BUCKET).remove(old);
  } catch {
    /* 정리 실패는 무시 */
  }
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

/** 해설지에서 AI가 정답만 읽어 돌려준다(저장하지 않음 — 화면에서 확인 후 saveMockKey). */
export async function readMockAnswers(code: string): Promise<Res<{ answers: CsatAnswers; found: number; gradeCuts: GradeCuts }>> {
  await requireRole("admin");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  if (!exam.solution_pdf_path) return { ok: false, msg: "먼저 해설지 PDF를 올려 주세요." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(exam.solution_pdf_path);
  if (error || !data) return { ok: false, msg: "해설지를 불러오지 못했습니다." };
  const pdf = Buffer.from(await data.arrayBuffer());
  return readMockAnswersFromPdf(admin, pdf);
}

/** 정답표 저장(공통 22 + 다 찬 선택과목). 빠진 칸이 있으면 저장하지 않고 알려 준다. 제출이 있으면 다시 채점. */
export async function saveMockKey(code: string, answers: CsatAnswers): Promise<Res<{ count: number; subjects: string[]; regraded: number; missing: string[] }>> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const { rows, missing, subjects } = buildKeyRows(answers ?? ({} as CsatAnswers));
  if (missing.some((m) => m.startsWith("공통"))) return { ok: false, msg: "공통 문항 정답이 비었거나 형식이 맞지 않습니다: " + missing.filter((m) => m.startsWith("공통")).join(", ") };
  if (!subjects.length) return { ok: false, msg: "선택과목을 하나 이상 23~30번까지 모두 채워 주세요." };
  const supabase = await createClient();
  const { error } = await (supabase.from("answer_key") as any).upsert(
    rows.map((r) => ({ exam_id: exam.id, ...r })),
    { onConflict: "exam_id,item_label" }
  );
  if (error) return { ok: false, msg: "정답표를 저장하지 못했습니다: " + error.message };
  // 새 정답표에 없는 줄(예: 지운 선택과목)은 지운다
  const keep = new Set(rows.map((r) => r.item_label));
  const { data: cur } = (await (supabase.from("answer_key") as any).select("id, item_label").eq("exam_id", exam.id)) as any;
  const drop = ((cur as any[]) ?? []).filter((r) => !keep.has(String(r.item_label))).map((r) => r.id);
  if (drop.length) await (supabase.from("answer_key") as any).delete().in("id", drop);
  const regraded = await regradeExam(createAdminClient(), exam.id).catch(() => 0);
  revalidatePath(`/exams/${code}`);
  return { ok: true, count: rows.length, subjects, regraded, missing };
}

/** 해설지 문항별 풀이 쪽(0054) 저장 — AI가 찾은 것(화면이 묶음 결과를 모음)이나 원장님이 고친 것. 빈 지도면 지운다. */
export async function saveSolutionPageMap(code: string, map: PageMap): Promise<Res<{ count: number }>> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const clean = cleanPageMap(map);
  const count = Object.keys(clean).length;
  const admin = createAdminClient();
  const { error } = await (admin.from("exams") as any).update({ solution_page_map: count ? clean : null }).eq("id", exam.id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true, count };
}

/** 예상 등급컷(0055) 저장 — 선택과목별 원점수 1컷부터. 모두 비우면 지운다. 보고서가 예상 등급을 낸다. */
export async function saveGradeCuts(code: string, cuts: GradeCuts): Promise<Res<{ subjects: number }>> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const clean = cleanGradeCuts(cuts);
  const n = Object.keys(clean).length;
  const admin = createAdminClient();
  const { error } = await (admin.from("exams") as any).update({ grade_cuts: n ? clean : null }).eq("id", exam.id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true, subjects: n };
}

// ---------------------------------------------------------------------
// 기출 아이디어 연결(0057 mock_gichul_links) — 2026-10-12 원장님 "4점 문항만, 사이트에 등록"
// 문항마다 같은 아이디어의 평가원 기출(출처·공통 아이디어 한 줄·기출 문제 그림). 보고서가 출처와 그림을 싣는다.
// ---------------------------------------------------------------------

const GICHUL = "mock_gichul_links";

/** 기출 연결 하나 추가 — 그림은 화면에서 작게 줄인 data URL */
export async function addGichulLink(code: string, input: Partial<GichulLink>): Promise<Res<{ id: string }>> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const c = cleanGichulInput(input);
  if (!c) return { ok: false, msg: "문항 번호와 기출 출처를 적어 주세요." };
  const admin = createAdminClient();
  const { data, error } = await (admin.from(GICHUL) as any)
    .insert({ exam_id: exam.id, item_label: c.label, rank: c.rank, source: c.source, idea: c.idea, image: c.image })
    .select("id")
    .single();
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true, id: data.id as string };
}

/** 출처·아이디어·순서 고치기(그림은 그대로, image를 주면 바꿈) */
export async function updateGichulLink(code: string, id: string, input: Partial<GichulLink>): Promise<Res> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const c = cleanGichulInput({ ...input, label: input.label ?? "x" });
  if (!c) return { ok: false, msg: "기출 출처를 적어 주세요." };
  const patch: Record<string, unknown> = { source: c.source, idea: c.idea, rank: c.rank };
  if (input.image !== undefined) patch.image = c.image;
  if (input.label) patch.item_label = c.label;
  const admin = createAdminClient();
  const { error } = await (admin.from(GICHUL) as any).update(patch).eq("id", id).eq("exam_id", exam.id);
  if (error) return { ok: false, msg: "저장하지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

export async function deleteGichulLink(code: string, id: string): Promise<Res> {
  await requireRole("editor");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const admin = createAdminClient();
  const { error } = await (admin.from(GICHUL) as any).delete().eq("id", id).eq("exam_id", exam.id);
  if (error) return { ok: false, msg: "지우지 못했습니다: " + error.message };
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

/** JSON 파일로 한꺼번에 넣기(관리자) — 같은 문항·같은 출처가 이미 있으면 건너뜀. replace면 이 시험의 연결을 먼저 모두 지움 */
export async function importGichulLinks(code: string, text: string, replace = false): Promise<Res<{ added: number; skipped: number }>> {
  await requireRole("admin");
  const exam = await examByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  let parsed: { links: GichulLink[]; skipped: number };
  try {
    parsed = parseGichulImport(text);
  } catch (e: any) {
    return { ok: false, msg: String(e?.message ?? e) };
  }
  const admin = createAdminClient();
  if (replace) {
    const { error } = await (admin.from(GICHUL) as any).delete().eq("exam_id", exam.id);
    if (error) return { ok: false, msg: "기존 연결을 지우지 못했습니다: " + error.message };
  }
  const { data: have } = await (admin.from(GICHUL) as any).select("item_label, source").eq("exam_id", exam.id);
  const seen = new Set(((have as any[]) ?? []).map((r) => `${r.item_label}\u0000${r.source}`));
  let skipped = parsed.skipped;
  const rows = [];
  for (const l of parsed.links) {
    const k = `${l.label}\u0000${l.source}`;
    if (seen.has(k)) {
      skipped++;
      continue;
    }
    seen.add(k);
    rows.push({ exam_id: exam.id, item_label: l.label, rank: l.rank, source: l.source, idea: l.idea, image: l.image });
  }
  // 그림이 커서 몇 개씩 나눠 넣는다
  for (let i = 0; i < rows.length; i += 8) {
    const { error } = await (admin.from(GICHUL) as any).insert(rows.slice(i, i + 8));
    if (error) return { ok: false, msg: `${i}번째부터 넣지 못했습니다: ` + error.message };
  }
  revalidatePath(`/exams/${code}`);
  return { ok: true, added: rows.length, skipped };
}
