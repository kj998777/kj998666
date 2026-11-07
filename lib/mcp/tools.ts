import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizePdfUpload } from "@/lib/ai/pdf";
import { applyNewPdfLocations } from "@/lib/ai/relocate";
import { regradeExam } from "@/lib/review/regrade";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { mcChoices } from "@/lib/review/mcAnswer";
import { guessFolder } from "@/lib/exams/guessFolder";
import { buildKeyRows, cleanGradeCuts, cleanPageMap, isChoiceKey, type CsatAnswers } from "@/lib/exams/mockCsat";
import { mockSource } from "@/lib/exams/mockSource";
import type { McpAuth, StaffRole } from "./oauth";
import { ToolError, arr, asArgs, auditArgs, bool, examCode, int, looksLikePdf, num, obj, oneOf, searchWord, str, type Args } from "./args";

// 메딕차트 MCP 도구(2026-11-07, 0059). 관리자·직원만 연결(lib/mcp/oauth.ts) — 각 도구의 minRole로 다시 막는다.
//   열람자(viewer): 찾기·보기만 / 편집자(editor): 시험 만들기·PDF 올리기·정답표·해설·등급컷·해설 쪽·시험 정보 / 관리자: 열기·닫기.
// DB는 서비스롤로 쓰지만(토큰 사용자의 쿠키가 없으므로), 화면의 서버 액션과 같은 규칙을 여기서 그대로 지킨다
// (정답표를 고치면 해설 정답 표시 맞추기 + 다시 채점, 시험 열기는 관리자 + 정답표 필수 — mcp_set_exam_status).
// 지우는 도구는 일부러 없다. 모든 호출은 mcp_audit에 남는다.

const BUCKET = "exam-pdfs";
const PDF_MAX = 50 * 1024 * 1024;
const BASE64_MAX = 3 * 1024 * 1024; // Vercel 요청 본문 4.5MB 한도 안에서
const RANK: Record<StaffRole, number> = { viewer: 0, editor: 1, admin: 2 };
const DIFFICULTIES = ["하", "중하", "중", "중상", "상"] as const;

export type ToolCtx = { auth: McpAuth; origin: string };
type JsonSchema = Record<string, unknown>;
export type ToolDef = {
  name: string;
  title: string;
  description: string;
  minRole: StaffRole;
  write: boolean;
  inputSchema: JsonSchema;
  run: (a: Args, ctx: ToolCtx, db: any) => Promise<unknown>;
};

const S = {
  code: { type: "string", description: "시험 코드(예: kice2709, s3hm1, 2025-22M01). search_exams로 찾을 수 있다." },
};
const schema = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

const EXAM_COLS =
  "id, code, name, status, school_level, folder_year, folder_grade, folder_term, folder_kind, collection, is_jeju, mock_csat, tutor_download_cost, solution_pdf_path, solution_page_map, grade_cuts, created_at";

async function examByCode(db: any, code: string): Promise<any> {
  const { data, error } = await db.from("exams").select(EXAM_COLS).eq("code", code).maybeSingle();
  if (error) throw new ToolError("시험을 불러오지 못했습니다: " + error.message);
  if (!data) throw new ToolError(`시험 코드 "${code}"를 찾을 수 없습니다. search_exams로 코드를 확인해 주세요.`);
  return data;
}

function touch(code: string) {
  try {
    revalidatePath("/exams");
    revalidatePath(`/exams/${code}`);
    revalidatePath(`/exams/${code}/results`);
  } catch {
    /* 캐시 무효화 실패는 무시 */
  }
}

function folderLabel(e: any): string {
  const lv = e.school_level === "고" ? "고" : e.school_level === "중" ? "중" : "";
  return [e.folder_year && `${e.folder_year}`, lv && e.folder_grade ? `${lv}${e.folder_grade}` : e.folder_grade ? `${e.folder_grade}학년` : "", e.folder_kind === "모의고사" ? "모의고사" : [e.folder_term && `${e.folder_term}학기`, e.folder_kind].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}

/** 해설의 정답 표시를 정답표 모양으로(app/(staff)/exams/[code]/actions.ts syncAnswerDisplayToKey와 같음) */
async function syncDisplay(db: any, examId: string, label: string, type: string, key: string): Promise<string | null> {
  const { data: ie } = await db.from("item_explanations").select("id, answer_display, ai_answer_display").eq("exam_id", examId).eq("item_label", label).maybeSingle();
  if (!ie) return null;
  const { mismatch, text } = reconcileKeyDisplay(type, key, ie.answer_display);
  if (!mismatch) return null;
  const patch: Record<string, unknown> = { answer_display: text, updated_at: new Date().toISOString() };
  if (ie.ai_answer_display == null) patch.ai_answer_display = ie.answer_display ?? "";
  const { error } = await db.from("item_explanations").update(patch).eq("id", ie.id);
  return error ? null : text;
}

function ymd(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(2, 10).replace(/-/g, "");
}
const rand4 = () => Math.random().toString(36).slice(2, 6);

async function readPdfSource(a: Args): Promise<Uint8Array | null> {
  const url = str(a, "source_url", { max: 2000 });
  const b64 = str(a, "base64", { trim: true });
  if (url && b64) throw new ToolError("source_url과 base64 중 하나만 주세요.");
  if (url) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ToolError("source_url이 올바른 주소가 아닙니다.");
    }
    if (u.protocol !== "https:") throw new ToolError("source_url은 https 주소만 됩니다.");
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".internal")) throw new ToolError("내부 주소는 받을 수 없습니다.");
    const res = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(45_000), cache: "no-store" });
    if (!res.ok) throw new ToolError(`PDF를 받지 못했습니다(HTTP ${res.status}).`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > PDF_MAX) throw new ToolError("PDF가 50MB를 넘습니다.");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > PDF_MAX) throw new ToolError("PDF가 50MB를 넘습니다.");
    if (!looksLikePdf(buf)) throw new ToolError("받은 파일이 PDF가 아닙니다.");
    return buf;
  }
  if (b64) {
    const clean = b64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
    const buf = new Uint8Array(Buffer.from(clean, "base64"));
    if (buf.length > BASE64_MAX) throw new ToolError("base64로는 3MB까지만 됩니다. 큰 파일은 create_upload_url로 올리세요.");
    if (!looksLikePdf(buf)) throw new ToolError("base64가 PDF가 아닙니다.");
    return buf;
  }
  return null;
}

async function attachProblemPdf(db: any, exam: any, userId: string, bytesOrPath: Uint8Array | string) {
  if (typeof bytesOrPath !== "string") {
    const path = `${exam.id}/${Date.now()}.pdf`;
    const { error } = await db.storage.from(BUCKET).upload(path, bytesOrPath, { contentType: "application/pdf", upsert: false });
    if (error) throw new ToolError("문제지를 저장하지 못했습니다: " + error.message);
  }
  const r = await finalizePdfUpload(db, exam.id, { isScanned: null, uploadedBy: userId });
  try {
    await applyNewPdfLocations(db, exam.id, []);
  } catch {
    /* 문항 자르기 좌표 정리 실패는 무시 */
  }
  return r.pages;
}

async function attachSolutionPdf(db: any, exam: any, bytesOrPath: Uint8Array | string) {
  let path: string;
  if (typeof bytesOrPath === "string") path = bytesOrPath;
  else {
    path = `_solutions/${exam.id}/${Date.now()}.pdf`;
    const { error } = await db.storage.from(BUCKET).upload(path, bytesOrPath, { contentType: "application/pdf", upsert: false });
    if (error) throw new ToolError("해설지를 저장하지 못했습니다: " + error.message);
  }
  // 해설지가 바뀌면 예전 해설 쪽 지도는 맞지 않으므로 지운다(mock-actions.ts finalizeSolutionPdf와 같음)
  const { error } = await db.from("exams").update({ solution_pdf_path: path, solution_page_map: null }).eq("id", exam.id);
  if (error) throw new ToolError("해설지를 연결하지 못했습니다: " + error.message);
  try {
    const prefix = `_solutions/${exam.id}/`;
    const { data: files } = await db.storage.from(BUCKET).list(`_solutions/${exam.id}`, { limit: 100 });
    const old = ((files as any[]) ?? []).map((f) => `${prefix}${f.name}`).filter((p) => p !== path);
    if (old.length) await db.storage.from(BUCKET).remove(old);
  } catch {
    /* 정리 실패는 무시 */
  }
  return path;
}

export const TOOLS: ToolDef[] = [
  // ───────────── 읽기 ─────────────
  {
    name: "search_exams",
    title: "시험 찾기",
    description:
      "메딕차트의 시험(학교 내신 기출·모의고사)을 찾는다. 이름·코드 검색어, 상태(열림/닫힘/검수대기), 모의고사만, 학교급·연도·학년으로 거른다. 최근 만든 순. 결과의 code를 다른 도구에 쓴다.",
    minRole: "viewer",
    write: false,
    inputSchema: schema({
      query: { type: "string", description: "이름·코드에 들어간 말(띄어 쓰면 모두 포함). 예: '대기고 2학년', '모의평가'" },
      status: { type: "string", enum: ["열림", "닫힘", "검수대기"] },
      mock_only: { type: "boolean", description: "true면 모의고사(평가원·사설)만" },
      school_level: { type: "string", enum: ["중", "고"] },
      year: { type: "string", description: "폴더 연도(시행 연도, 예: 2026)" },
      grade: { type: "integer", minimum: 1, maximum: 3 },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    }),
    async run(a, _ctx, db) {
      const limit = int(a, "limit", { min: 1, max: 200 }) ?? 50;
      let q = db.from("exams").select("code, name, status, school_level, folder_year, folder_grade, folder_term, folder_kind, mock_csat, collection, created_at", { count: "exact" });
      const query = str(a, "query", { max: 100 });
      if (query) for (const w of query.split(/\s+/).map(searchWord).filter(Boolean)) q = q.or(`name.ilike.%${w}%,code.ilike.%${w}%`);
      const status = oneOf(a, "status", ["열림", "닫힘", "검수대기"] as const);
      if (status) q = q.eq("status", status);
      if (bool(a, "mock_only")) q = q.eq("folder_kind", "모의고사");
      const lv = oneOf(a, "school_level", ["중", "고"] as const);
      if (lv) q = q.eq("school_level", lv);
      const year = str(a, "year", { max: 4 });
      if (year) q = q.eq("folder_year", year);
      const grade = int(a, "grade", { min: 1, max: 3 });
      if (grade) q = q.eq("folder_grade", grade);
      const { data, error, count } = await q.order("created_at", { ascending: false }).limit(limit);
      if (error) throw new ToolError("시험을 찾지 못했습니다: " + error.message);
      return {
        total: count ?? data?.length ?? 0,
        shown: data?.length ?? 0,
        exams: (data ?? []).map((e: any) => ({
          code: e.code,
          name: e.name,
          status: e.status,
          folder: folderLabel(e),
          mock: e.folder_kind === "모의고사" ? mockSource(e.name) : undefined,
          collection: e.collection ?? undefined,
        })),
      };
    },
  },
  {
    name: "get_exam",
    title: "시험 자세히",
    description:
      "시험 하나의 정보: 상태·폴더, 문제지 PDF(쪽수)·해설지 유무, 정답표 전체(번호·정답·배점·형식), 모의고사 예상 등급컷·해설 쪽 지도, 문항 해설 수, 제출 수, 관련 기출 연결 수.",
    minRole: "viewer",
    write: false,
    inputSchema: schema({ code: S.code }, ["code"]),
    async run(a, ctx, db) {
      const e = await examByCode(db, examCode(a));
      const [pdf, keys, ie, subs, gichul] = await Promise.all([
        db.from("exam_pdf_meta").select("pages, uploaded_at, is_scanned, replaced_with_digitized").eq("exam_id", e.id).maybeSingle(),
        db.from("answer_key").select("item_label, correct_answers, points, type, sort_order").eq("exam_id", e.id).order("sort_order").order("item_label"),
        db.from("item_explanations").select("id", { count: "exact", head: true }).eq("exam_id", e.id),
        db.from("submissions").select("id, tutor_id").eq("exam_id", e.id),
        db.from("mock_gichul_links").select("id", { count: "exact", head: true }).eq("exam_id", e.id),
      ]);
      const keyRows = (keys.data ?? []) as any[];
      const allSubs = (subs.data ?? []) as any[];
      return {
        code: e.code,
        name: e.name,
        status: e.status,
        folder: folderLabel(e),
        school_level: e.school_level,
        folder_year: e.folder_year,
        folder_grade: e.folder_grade,
        folder_term: e.folder_term,
        folder_kind: e.folder_kind,
        collection: e.collection,
        is_jeju: e.is_jeju,
        mock: e.folder_kind === "모의고사" || e.mock_csat ? { source: mockSource(e.name), csat_format: !!e.mock_csat, grade_cuts: e.grade_cuts ?? null, solution_page_map: e.solution_page_map ?? null } : null,
        tutor_download_cost: e.tutor_download_cost,
        problem_pdf: pdf.data ? { pages: pdf.data.pages, uploaded_at: pdf.data.uploaded_at, scanned: pdf.data.is_scanned, digitized: pdf.data.replaced_with_digitized } : null,
        solution_pdf: !!e.solution_pdf_path,
        answer_key: keyRows.map((k) => ({ label: k.item_label, answer: k.correct_answers, points: Number(k.points), type: k.type })),
        total_points: keyRows.reduce((s, k) => s + Number(k.points || 0), 0),
        item_explanations: ie.count ?? 0,
        submissions: { academy: allSubs.filter((s) => !s.tutor_id).length, tutors: allSubs.filter((s) => s.tutor_id).length },
        gichul_links: gichul.count ?? 0,
        page: `${ctx.origin}/exams/${encodeURIComponent(e.code)}`,
      };
    },
  },
  {
    name: "get_items",
    title: "문항 해설 보기",
    description:
      "시험의 문항별 해설(문제 요약·정답 표시·풀이·단원·난이도·검토 상태)과 정답표 정답. labels를 비우면 전체. detail=false면 풀이·문제 글은 빼고 요약만.",
    minRole: "viewer",
    write: false,
    inputSchema: schema(
      {
        code: S.code,
        labels: { type: "array", items: { type: "string" }, description: "문항 번호(정답표 번호 그대로: '1', '서술형3', '확통29')" },
        detail: { type: "boolean", default: true },
      },
      ["code"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const labels = (arr(a, "labels", { max: 200 }) ?? []).map((x) => String(x).trim()).filter(Boolean);
      const detail = bool(a, "detail", true);
      const cols = detail
        ? "item_label, area, unit, difficulty, difficulty_reason, problem_statement, answer_display, solution, logic_type, review_confirmed, review_stage, exam_error_suspected, exam_error_reason, source_page"
        : "item_label, area, unit, difficulty, answer_display, logic_type, review_confirmed, exam_error_suspected";
      let q = db.from("item_explanations").select(cols).eq("exam_id", e.id);
      if (labels.length) q = q.in("item_label", labels);
      const [{ data: items, error }, { data: keys }] = await Promise.all([q, db.from("answer_key").select("item_label, correct_answers, points, type, sort_order").eq("exam_id", e.id)]);
      if (error) throw new ToolError("해설을 불러오지 못했습니다: " + error.message);
      const keyBy = new Map(((keys ?? []) as any[]).map((k) => [k.item_label, k]));
      const order = (l: string) => (keyBy.get(l)?.sort_order ?? 9999) as number;
      const out = ((items ?? []) as any[])
        .sort((x, y) => order(x.item_label) - order(y.item_label))
        .map((it) => ({ ...it, key: keyBy.get(it.item_label) ? { answer: keyBy.get(it.item_label).correct_answers, points: Number(keyBy.get(it.item_label).points), type: keyBy.get(it.item_label).type } : null }));
      return { code: e.code, name: e.name, count: out.length, items: out, note: out.length ? undefined : "문항 해설이 없습니다(모의고사는 해설 대신 해설지 PDF를 씁니다)." };
    },
  },
  {
    name: "exam_results",
    title: "제출 결과",
    description:
      "시험의 학생 제출 결과: 제출 수·평균·최고·최저, 문항별 정답률(낮은 순)과 무응답 수. include_students=true면 학생별 이름·반·점수(학원 제출만, 과외선생님 학생은 include_tutor=true).",
    minRole: "viewer",
    write: false,
    inputSchema: schema(
      { code: S.code, include_students: { type: "boolean", default: false }, include_tutor: { type: "boolean", default: false } },
      ["code"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const withTutor = bool(a, "include_tutor", false);
      let sq = db.from("submissions").select("id, class_label, student_name, submitted_at, tutor_id").eq("exam_id", e.id);
      if (!withTutor) sq = sq.is("tutor_id", null);
      const { data: subs, error } = await sq;
      if (error) throw new ToolError("제출을 불러오지 못했습니다: " + error.message);
      const ids = ((subs ?? []) as any[]).map((s) => s.id);
      const grades: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("grading_results").select("submission_id, per_item, total_score").in("submission_id", ids.slice(i, i + 200));
        grades.push(...((data ?? []) as any[]));
      }
      const scores = grades.map((g) => Number(g.total_score) || 0);
      const per = new Map<string, { n: number; correct: number; blank: number }>();
      for (const g of grades)
        for (const it of (Array.isArray(g.per_item) ? g.per_item : []) as any[]) {
          const m = per.get(it.item_label) ?? { n: 0, correct: 0, blank: 0 };
          m.n++;
          if (it.correct) m.correct++;
          if (!String(it.given ?? "").trim()) m.blank++;
          per.set(it.item_label, m);
        }
      const items = Array.from(per.entries())
        .map(([label, m]) => ({ label, answered_by: m.n, correct_rate: m.n ? Math.round((m.correct / m.n) * 1000) / 10 : null, blank: m.blank }))
        .sort((x, y) => (x.correct_rate ?? 0) - (y.correct_rate ?? 0));
      const byId = new Map(grades.map((g) => [g.submission_id, g]));
      return {
        code: e.code,
        name: e.name,
        submissions: ids.length,
        graded: grades.length,
        average: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null,
        max: scores.length ? Math.max(...scores) : null,
        min: scores.length ? Math.min(...scores) : null,
        items,
        students: bool(a, "include_students", false)
          ? ((subs ?? []) as any[])
              .map((s) => ({ name: s.student_name, class: s.class_label, score: byId.has(s.id) ? Number(byId.get(s.id).total_score) : null, submitted_at: s.submitted_at, via_tutor: !!s.tutor_id }))
              .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
          : undefined,
      };
    },
  },

  // ───────────── 쓰기(편집자) ─────────────
  {
    name: "create_exam",
    title: "시험 만들기",
    description:
      "새 시험을 '닫힘' 상태로 만든다(AI 처리 없음). mock=true면 고3 수능형 모의고사(선택과목 23~30, 해설지 PDF 사용) — 폴더는 이름의 'N학년도'로 (N-1)년 · 고3 · 모의고사. 학교 기출은 이름에서 학교급·연도·학년·학기·중간/기말을 읽고, 준 값이 있으면 그 값을 쓴다. 다음 순서: upload_exam_pdf(문제지·해설지) → set_mock_answers 또는 set_answer_key → (모의고사) set_grade_cuts·set_solution_pages → 관리자가 set_exam_status로 열기.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        name: { type: "string", description: "시험 이름. 예: '2027학년도 수능 수학', '제주 제주시 대기고등학교 2학년 2026년 2학기 미적분Ⅰ 중간'" },
        code: { type: "string", description: "시험 코드(학생 제출 링크에 쓰임, 비우면 자동). 영문·숫자·-·_ 권장" },
        mock: { type: "boolean", default: false },
        school_level: { type: "string", enum: ["중", "고"] },
        folder_year: { type: "string", description: "폴더 연도(시행 연도)" },
        folder_grade: { type: "integer", minimum: 1, maximum: 3 },
        folder_term: { type: "integer", minimum: 1, maximum: 2 },
        folder_kind: { type: "string", enum: ["중간", "기말", "기타", "모의고사"] },
      },
      ["name"]
    ),
    async run(a, ctx, db) {
      const name = str(a, "name", { required: true, max: 200 })!;
      const mock = bool(a, "mock", false);
      let code = str(a, "code", { max: 80 });
      if (code && !/^[\p{L}\p{N}_\-.]+$/u.test(code)) throw new ToolError("code에는 글자·숫자·-·_·.만 쓸 수 있습니다.");
      if (!code) code = (mock ? "mock" : "ex") + ymd() + "-" + rand4();
      const g = guessFolder(name, code);
      const row: Record<string, unknown> = mock
        ? {
            mock_csat: true,
            school_level: "고",
            folder_year: str(a, "folder_year", { max: 4 }) ?? g.folder_year ?? String(new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear()),
            folder_grade: int(a, "folder_grade", { min: 1, max: 3 }) ?? 3,
            folder_term: null,
            folder_kind: "모의고사",
          }
        : {
            school_level: oneOf(a, "school_level", ["중", "고"] as const) ?? g.school_level,
            folder_year: str(a, "folder_year", { max: 4 }) ?? g.folder_year,
            folder_grade: int(a, "folder_grade", { min: 1, max: 3 }) ?? g.folder_grade,
            folder_term: int(a, "folder_term", { min: 1, max: 2 }) ?? g.folder_term,
            folder_kind: oneOf(a, "folder_kind", ["중간", "기말", "기타", "모의고사"] as const) ?? g.folder_kind,
          };
      const { data, error } = await db
        .from("exams")
        .insert({ code, name, status: "닫힘", created_by: ctx.auth.userId, ...row })
        .select("id, code, name, school_level, folder_year, folder_grade, folder_term, folder_kind, mock_csat")
        .single();
      if (error) throw new ToolError(error.code === "23505" ? `시험 코드 "${code}"는 이미 있습니다. 다른 코드를 주세요.` : "시험을 만들지 못했습니다: " + error.message);
      touch(data.code);
      return { created: true, code: data.code, name: data.name, folder: folderLabel(data), mock: !!data.mock_csat, page: `${ctx.origin}/exams/${encodeURIComponent(data.code)}` };
    },
  },
  {
    name: "create_upload_url",
    title: "PDF 올릴 주소 받기",
    description:
      "큰 PDF(최대 50MB)를 직접 올릴 1회용 주소를 만든다(2시간). 받은 upload_url로 PUT 요청을 보낸 뒤(예: curl -X PUT -H 'Content-Type: application/pdf' --data-binary @파일.pdf '<upload_url>'), upload_exam_pdf를 uploaded_path와 함께 불러 연결한다. 셸이 없는 환경이면 source_url(공개 https 주소)이나 base64(3MB까지)를 쓴다.",
    minRole: "editor",
    write: true,
    inputSchema: schema({ code: S.code, kind: { type: "string", enum: ["problem", "solution"], description: "problem=문제지, solution=해설지(모의고사)" } }, ["code", "kind"]),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const kind = oneOf(a, "kind", ["problem", "solution"] as const, { required: true })!;
      const path = kind === "problem" ? `${e.id}/${Date.now()}.pdf` : `_solutions/${e.id}/${Date.now()}.pdf`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new ToolError("올릴 주소를 만들지 못했습니다: " + (error?.message ?? "?"));
      return {
        upload_url: data.signedUrl,
        uploaded_path: data.path ?? path,
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expires_in_sec: 7200,
        next: `upload_exam_pdf({ code: "${e.code}", kind: "${kind}", uploaded_path: "${data.path ?? path}" })`,
      };
    },
  },
  {
    name: "upload_exam_pdf",
    title: "문제지·해설지 PDF 올리기",
    description:
      "시험에 문제지(problem) 또는 해설지(solution) PDF를 연결한다(AI 처리 없음). 셋 중 하나: source_url(https 공개 주소, 예: EBSi wdown 링크 — 서버가 받음) / base64(3MB까지) / uploaded_path(create_upload_url로 올린 경로). 문제지를 바꾸면 예전 문제지·스캔본은 정리되고, 해설지를 바꾸면 해설 쪽 지도가 비워진다.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        code: S.code,
        kind: { type: "string", enum: ["problem", "solution"] },
        source_url: { type: "string" },
        base64: { type: "string", description: "PDF 파일의 base64(3MB까지)" },
        uploaded_path: { type: "string" },
      },
      ["code", "kind"]
    ),
    async run(a, ctx, db) {
      const e = await examByCode(db, examCode(a));
      const kind = oneOf(a, "kind", ["problem", "solution"] as const, { required: true })!;
      const uploaded = str(a, "uploaded_path", { max: 200 });
      let src: Uint8Array | string | null = await readPdfSource(a);
      if (src && uploaded) throw new ToolError("uploaded_path는 source_url·base64와 같이 쓸 수 없습니다.");
      if (!src && uploaded) {
        const ok = kind === "problem" ? new RegExp(`^${e.id}/\\d+\\.pdf$`).test(uploaded) : new RegExp(`^_solutions/${e.id}/\\d+\\.pdf$`).test(uploaded);
        if (!ok) throw new ToolError("uploaded_path가 이 시험·종류의 경로가 아닙니다. create_upload_url이 준 값을 그대로 주세요.");
        const dir = uploaded.slice(0, uploaded.lastIndexOf("/"));
        const file = uploaded.slice(uploaded.lastIndexOf("/") + 1);
        const { data: found } = await db.storage.from(BUCKET).list(dir, { limit: 100, search: file });
        if (!((found as any[]) ?? []).some((f) => f.name === file)) throw new ToolError("아직 올라온 파일이 없습니다. upload_url로 PUT을 먼저 보내 주세요.");
        const { data: blob } = await db.storage.from(BUCKET).download(uploaded);
        if (!blob || !looksLikePdf(new Uint8Array(await blob.slice(0, 1024).arrayBuffer()))) throw new ToolError("올라온 파일이 PDF가 아닙니다.");
        src = uploaded;
      }
      if (!src) throw new ToolError("source_url, base64, uploaded_path 중 하나를 주세요.");
      if (kind === "problem") {
        const pages = await attachProblemPdf(db, e, ctx.auth.userId, src);
        touch(e.code);
        return { ok: true, code: e.code, kind, pages, note: "문제지를 연결했습니다(AI 처리 안 함)." };
      }
      const path = await attachSolutionPdf(db, e, src);
      touch(e.code);
      return { ok: true, code: e.code, kind, path, note: e.mock_csat ? "해설지를 연결했습니다. 해설 쪽 지도가 비었으니 set_solution_pages로 넣어 주세요." : "해설지를 연결했습니다." };
    },
  },
  {
    name: "set_mock_answers",
    title: "모의고사 정답표 넣기",
    description:
      "수능형 모의고사(mock) 정답표를 한 번에 넣는다. answers = { 공통: {1:'3', …, 22:'64'}, 확통: {23:'1', …, 30:'170'}, 미적: {…}, 기하: {…} }. 공통 1~22는 모두 있어야 하고, 선택과목은 23~30이 다 찬 과목만 들어간다. 배점·객관식/단답형은 수능 형식으로 자동(공통 74 + 선택 26). 객관식은 1~5 또는 ①~⑤. 정답표에서 빠진 번호는 지우고, 제출이 있으면 다시 채점한다.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        code: S.code,
        answers: {
          type: "object",
          description: "{ 공통: {번호: 정답}, 확통?: {23~30: 정답}, 미적?: {…}, 기하?: {…} }",
          properties: { 공통: { type: "object" }, 확통: { type: "object" }, 미적: { type: "object" }, 기하: { type: "object" } },
          required: ["공통"],
        },
      },
      ["code", "answers"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      if (!e.mock_csat) throw new ToolError("수능형 모의고사가 아닙니다. 학교 시험은 set_answer_key를 쓰세요.");
      const raw = obj(a, "answers", { required: true })!;
      const ans: CsatAnswers = { 공통: {}, 확통: {}, 미적: {}, 기하: {} };
      for (const [part, m] of Object.entries(raw)) {
        if (part !== "공통" && !isChoiceKey(part)) throw new ToolError(`answers의 "${part}"는 모르는 과목입니다(공통·확통·미적·기하).`);
        if (!m || typeof m !== "object") continue;
        for (const [no, v] of Object.entries(m as Record<string, unknown>)) (ans as any)[part][Number(no)] = v;
      }
      const { rows, missing, subjects } = buildKeyRows(ans);
      const commonMissing = missing.filter((m) => m.startsWith("공통"));
      if (commonMissing.length) throw new ToolError("공통 문항 정답이 비었거나 형식이 맞지 않습니다: " + commonMissing.join(", "));
      if (!subjects.length) throw new ToolError("선택과목을 하나 이상 23~30번까지 모두 채워 주세요.");
      const { error } = await db.from("answer_key").upsert(rows.map((r) => ({ exam_id: e.id, ...r })), { onConflict: "exam_id,item_label" });
      if (error) throw new ToolError("정답표를 저장하지 못했습니다: " + error.message);
      const keep = new Set(rows.map((r) => r.item_label));
      const { data: cur } = await db.from("answer_key").select("id, item_label").eq("exam_id", e.id);
      const drop = ((cur ?? []) as any[]).filter((r) => !keep.has(String(r.item_label))).map((r) => r.id);
      if (drop.length) await db.from("answer_key").delete().in("id", drop);
      const regraded = await regradeExam(db, e.id).catch(() => 0);
      touch(e.code);
      return { ok: true, code: e.code, saved: rows.length, subjects, total_points: rows.reduce((s, r) => s + r.points, 0), removed: drop.length, regraded, skipped: missing };
    },
  },
  {
    name: "set_answer_key",
    title: "정답표 고치기·넣기",
    description:
      "정답표 줄을 넣거나 고친다(학교 시험·모의고사 공통). rows = [{label:'1', answer:'3', points:4, type:'객관식'}, …]. 같은 번호가 있으면 덮어쓴다. points·type을 비우면 기존 값을 쓴다(새 번호면 필수). replace=true면 rows에 없는 번호는 지운다. 정답이 바뀐 문항은 해설의 정답 표시를 맞추고, 제출이 있으면 다시 채점한다.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        code: S.code,
        rows: {
          type: "array",
          maxItems: 120,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              answer: { type: "string", description: "객관식은 1~5(복수 정답은 '2,4'), 주관식은 값 그대로" },
              points: { type: "number" },
              type: { type: "string", enum: ["객관식", "주관식"] },
              sort_order: { type: "integer" },
            },
            required: ["label", "answer"],
          },
        },
        replace: { type: "boolean", default: false },
      },
      ["code", "rows"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const rowsIn = arr(a, "rows", { required: true, max: 120 })!;
      const { data: cur } = await db.from("answer_key").select("id, item_label, correct_answers, points, type, sort_order").eq("exam_id", e.id);
      const curBy = new Map(((cur ?? []) as any[]).map((r) => [String(r.item_label), r]));
      let nextOrder = Math.max(-1, ...((cur ?? []) as any[]).map((r) => Number(r.sort_order) || 0)) + 1;
      const rows: any[] = [];
      const seen = new Set<string>();
      for (const [i, x] of rowsIn.entries()) {
        const r = asArgs(x);
        const label = str(r, "label", { required: true, max: 30 })!;
        if (seen.has(label)) throw new ToolError(`rows에 ${label}번이 두 번 있습니다.`);
        seen.add(label);
        const old = curBy.get(label);
        const type = oneOf(r, "type", ["객관식", "주관식"] as const) ?? old?.type;
        const points = num(r, "points", { min: 0, max: 100 }) ?? (old ? Number(old.points) : undefined);
        if (!type || points === undefined) throw new ToolError(`rows[${i}](${label}번): 새 번호라 points와 type이 필요합니다.`);
        let answer = str(r, "answer", { required: true, max: 200 })!;
        if (type === "객관식") {
          const c = mcChoices(answer);
          if (!c) throw new ToolError(`${label}번: 객관식 정답은 1~5(또는 ①~⑤)여야 합니다.`);
          answer = c;
        }
        rows.push({ exam_id: e.id, item_label: label, correct_answers: answer, points, type, sort_order: int(r, "sort_order", { min: 0, max: 999 }) ?? old?.sort_order ?? nextOrder++ });
      }
      const { error } = await db.from("answer_key").upsert(rows, { onConflict: "exam_id,item_label" });
      if (error) throw new ToolError("정답표를 저장하지 못했습니다: " + error.message);
      let removed = 0;
      if (bool(a, "replace", false)) {
        const drop = ((cur ?? []) as any[]).filter((r) => !seen.has(String(r.item_label))).map((r) => r.id);
        if (drop.length) {
          await db.from("answer_key").delete().in("id", drop);
          removed = drop.length;
        }
      }
      const changed = rows.filter((r) => {
        const o = curBy.get(r.item_label);
        return !o || String(o.correct_answers ?? "").trim() !== r.correct_answers || o.type !== r.type;
      });
      const synced: string[] = [];
      for (const r of changed) {
        const t = await syncDisplay(db, e.id, r.item_label, r.type, r.correct_answers);
        if (t) synced.push(`${r.item_label}→${t}`);
      }
      const regraded = changed.length || removed ? await regradeExam(db, e.id).catch(() => 0) : 0;
      touch(e.code);
      return { ok: true, code: e.code, saved: rows.length, changed: changed.map((r) => r.item_label), removed, display_synced: synced, regraded };
    },
  },
  {
    name: "update_item",
    title: "문항 해설 고치기",
    description:
      "문항 해설 한 개를 고친다: answer_display(정답 표시), solution(풀이), problem_statement(문제 요약), unit(단원), area(영역), difficulty(하·중하·중·중상·상). 객관식 정답 표시는 정답표와 달라야 할 수 없다(정답을 바꾸려면 set_answer_key). 수식은 $…$ LaTeX.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        code: S.code,
        label: { type: "string" },
        answer_display: { type: "string" },
        solution: { type: "string" },
        problem_statement: { type: "string" },
        unit: { type: "string" },
        area: { type: "string" },
        difficulty: { type: "string", enum: [...DIFFICULTIES] },
      },
      ["code", "label"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const label = str(a, "label", { required: true, max: 30 })!;
      const { data: ie } = await db.from("item_explanations").select("id, answer_display").eq("exam_id", e.id).eq("item_label", label).maybeSingle();
      if (!ie) throw new ToolError(`${label}번 문항 해설이 없습니다.`);
      const patch: Record<string, unknown> = {};
      const disp = str(a, "answer_display", { max: 500 });
      if (disp !== undefined) patch.answer_display = disp;
      const sol = str(a, "solution", { max: 20000, trim: false });
      if (sol !== undefined) patch.solution = sol;
      const ps = str(a, "problem_statement", { max: 8000, trim: false });
      if (ps !== undefined) patch.problem_statement = ps;
      const unit = str(a, "unit", { max: 200 });
      if (unit !== undefined) patch.unit = unit;
      const area = str(a, "area", { max: 200 });
      if (area !== undefined) patch.area = area;
      const diff = oneOf(a, "difficulty", DIFFICULTIES);
      if (diff) patch.difficulty = diff;
      if (!Object.keys(patch).length) throw new ToolError("고칠 칸을 하나 이상 주세요.");
      let warn: string | undefined;
      if (disp) {
        const { data: key } = await db.from("answer_key").select("correct_answers, type").eq("exam_id", e.id).eq("item_label", label).maybeSingle();
        if (key && String(key.correct_answers ?? "").trim()) {
          const { mismatch, text } = reconcileKeyDisplay(key.type, key.correct_answers, disp);
          if (mismatch && key.type === "객관식" && mcChoices(disp)) throw new ToolError(`정답표는 ${text}입니다. 정답을 바꾸려면 set_answer_key로 정답표를 고쳐 주세요.`);
          if (mismatch) warn = `정답표("${key.correct_answers}")와 같은 값인지 확인해 주세요 — 해설지·보고서에는 정답표 쪽이 보입니다.`;
        }
      }
      patch.updated_at = new Date().toISOString();
      const { error } = await db.from("item_explanations").update(patch).eq("id", ie.id);
      if (error) throw new ToolError("저장하지 못했습니다: " + error.message);
      touch(e.code);
      return { ok: true, code: e.code, label, updated: Object.keys(patch).filter((k) => k !== "updated_at"), warning: warn };
    },
  },
  {
    name: "set_grade_cuts",
    title: "예상 등급컷 넣기",
    description:
      "모의고사 예상 등급컷(원점수)을 과목별로 넣는다. cuts = { 확통: [1컷, 2컷, 3컷, …], 미적: […], 기하: […] } — 1등급부터 내려가는 순서, 최대 8개. 빈 객체면 지운다. 보고서에 학생별 예상 등급이 나온다.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      { code: S.code, cuts: { type: "object", properties: { 확통: { type: "array", items: { type: "number" } }, 미적: { type: "array", items: { type: "number" } }, 기하: { type: "array", items: { type: "number" } } } } },
      ["code", "cuts"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const raw = obj(a, "cuts", { required: true })!;
      const clean = cleanGradeCuts(raw);
      for (const [k, v] of Object.entries(raw)) {
        const got = (clean as any)[k] as number[] | undefined;
        if (Array.isArray(v) && v.length && (!got || got.length !== v.length)) throw new ToolError(`${k} 등급컷은 0~100 숫자를 1등급부터 내려가는 순서로 주세요(받은 값: ${JSON.stringify(v)}).`);
      }
      const n = Object.keys(clean).length;
      const { error } = await db.from("exams").update({ grade_cuts: n ? clean : null }).eq("id", e.id);
      if (error) throw new ToolError("저장하지 못했습니다: " + error.message);
      touch(e.code);
      return { ok: true, code: e.code, grade_cuts: n ? clean : null };
    },
  },
  {
    name: "set_solution_pages",
    title: "해설 쪽 지도 넣기",
    description:
      "모의고사 해설지에서 문항별 풀이가 있는 쪽(1부터)을 넣는다. map = { '1': [1], '15': [6, 7], '확통29': [16] } — 개별 보고서가 학생이 틀린 문항의 이 쪽들을 뒤에 붙인다. 빈 객체면 지운다.",
    minRole: "editor",
    write: true,
    inputSchema: schema({ code: S.code, map: { type: "object", description: "{ 문항번호: [쪽, …] }" } }, ["code", "map"]),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const raw = obj(a, "map", { required: true })!;
      const clean = cleanPageMap(raw);
      const dropped = Object.keys(raw).filter((k) => !(k in clean));
      const n = Object.keys(clean).length;
      const { error } = await db.from("exams").update({ solution_page_map: n ? clean : null }).eq("id", e.id);
      if (error) throw new ToolError("저장하지 못했습니다: " + error.message);
      touch(e.code);
      return { ok: true, code: e.code, saved: n, ignored: dropped.length ? dropped : undefined };
    },
  },
  {
    name: "update_exam",
    title: "시험 정보 고치기",
    description: "시험 이름·폴더(학교급·연도·학년·학기·구분)·자료 모음(collection)·제주 학교 표시를 고친다. 상태(열기/닫기)는 set_exam_status.",
    minRole: "editor",
    write: true,
    inputSchema: schema(
      {
        code: S.code,
        name: { type: "string" },
        school_level: { type: "string", enum: ["중", "고"] },
        folder_year: { type: "string" },
        folder_grade: { type: ["integer", "null"], minimum: 1, maximum: 3 },
        folder_term: { type: ["integer", "null"], minimum: 1, maximum: 2 },
        folder_kind: { type: ["string", "null"], enum: ["중간", "기말", "기타", "모의고사", null] },
        collection: { type: ["string", "null"], description: "학교 기출이 아닌 자료 모음 이름(예: 부교재 변형문제). null이면 뺌" },
        is_jeju: { type: "boolean" },
      },
      ["code"]
    ),
    async run(a, _ctx, db) {
      const e = await examByCode(db, examCode(a));
      const patch: Record<string, unknown> = {};
      const name = str(a, "name", { max: 200 });
      if (name) patch.name = name;
      const lv = oneOf(a, "school_level", ["중", "고"] as const);
      if (lv) patch.school_level = lv;
      const fy = str(a, "folder_year", { max: 4 });
      if (fy !== undefined) {
        if (!/^20\d{2}$/.test(fy)) throw new ToolError("folder_year는 2020 같은 네 자리 연도여야 합니다.");
        patch.folder_year = fy;
      }
      if ("folder_grade" in a) patch.folder_grade = a.folder_grade === null ? null : int(a, "folder_grade", { min: 1, max: 3 });
      if ("folder_term" in a) patch.folder_term = a.folder_term === null ? null : int(a, "folder_term", { min: 1, max: 2 });
      if ("folder_kind" in a) patch.folder_kind = a.folder_kind === null ? null : oneOf(a, "folder_kind", ["중간", "기말", "기타", "모의고사"] as const);
      if ("collection" in a) patch.collection = a.collection === null ? null : str(a, "collection", { max: 60 }) || null;
      const jeju = bool(a, "is_jeju");
      if (jeju !== undefined) patch.is_jeju = jeju;
      if (!Object.keys(patch).length) throw new ToolError("고칠 칸을 하나 이상 주세요.");
      const { data, error } = await db.from("exams").update(patch).eq("id", e.id).select("code, name, school_level, folder_year, folder_grade, folder_term, folder_kind, collection, is_jeju").single();
      if (error) throw new ToolError("저장하지 못했습니다: " + error.message);
      touch(e.code);
      return { ok: true, code: data.code, name: data.name, folder: folderLabel(data), collection: data.collection, is_jeju: data.is_jeju };
    },
  },

  // ───────────── 관리자 ─────────────
  {
    name: "set_exam_status",
    title: "시험 열기·닫기",
    description: "학생 제출을 열거나(open=true → '열림') 닫는다. 관리자만. 정답표가 없는 시험은 열 수 없고, 검수 대기 시험은 화면의 검수 확정으로만 연다. 처음 열면 과외선생님 스토어 가격이 3P로 정해진다.",
    minRole: "admin",
    write: true,
    inputSchema: schema({ code: S.code, open: { type: "boolean" } }, ["code", "open"]),
    async run(a, ctx, db) {
      const e = await examByCode(db, examCode(a));
      const open = bool(a, "open");
      if (open === undefined) throw new ToolError("open(true/false)이 필요합니다.");
      const target = open ? "열림" : "닫힘";
      if (e.status === target) return { ok: true, code: e.code, status: target, note: "이미 그 상태입니다." };
      const { data, error } = await db.rpc("mcp_set_exam_status", { p_exam_id: e.id, p_status: target, p_actor: ctx.auth.userId });
      if (error) throw new ToolError(error.message);
      touch(e.code);
      return { ok: true, code: e.code, before: data, status: target };
    },
  },
];

export function toolsFor(role: StaffRole): ToolDef[] {
  return TOOLS.filter((t) => RANK[role] >= RANK[t.minRole]);
}

export function toolListing(role: StaffRole) {
  return toolsFor(role).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write || t.name.startsWith("set_"), openWorldHint: t.name === "upload_exam_pdf" },
  }));
}

/** tools/call — 결과는 MCP content(글) + structuredContent. 쓰기·읽기 모두 mcp_audit에 남긴다. */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  const args = asArgs(rawArgs);
  const db: any = createAdminClient();
  const log = async (ok: boolean, message: string | null) => {
    try {
      await db.from("mcp_audit").insert({ user_id: ctx.auth.userId, grant_id: ctx.auth.grantId, tool: name.slice(0, 60), write: !!t?.write, args: auditArgs(args), ok, message: message?.slice(0, 500) ?? null });
    } catch {
      /* 기록 실패는 무시 */
    }
  };
  if (!t) {
    await log(false, "모르는 도구");
    return { content: [{ type: "text", text: `모르는 도구입니다: ${name}` }], isError: true };
  }
  if (RANK[ctx.auth.role] < RANK[t.minRole]) {
    await log(false, "권한 없음");
    return { content: [{ type: "text", text: `${t.title}은(는) ${t.minRole === "admin" ? "관리자" : "편집자"} 이상만 쓸 수 있습니다(지금 계정: ${ctx.auth.role}).` }], isError: true };
  }
  try {
    const result = await t.run(args, ctx, db);
    await log(true, null);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (err: any) {
    const msg = err instanceof ToolError ? err.message : "처리 중 오류가 났습니다: " + String(err?.message ?? err).slice(0, 300);
    await log(false, msg);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
