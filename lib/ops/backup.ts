import "server-only";
import { gzipSync } from "zlib";

// 정기 백업(2026-09-28 원장님 요청 8). Supabase 무료 요금제는 자동 백업을 받아 둘 수 없으므로, 주요 테이블을
// 통째로 JSON으로 묶어 gzip한 파일을 비공개 Storage 버킷 "backups"(0025)에 주 1회 저장하고 최근 8개만 남긴다.
// 크론(/api/ai/cron-tick)이 호출할 때마다 "마지막 백업이 7일 넘었는지"만 보고, 넘었으면 새로 만든다.
// 관리자는 운영 현황 화면에서 목록을 보고 내려받거나 "지금 백업"을 누를 수 있다.
//
// 빼는 것: ai_settings(Anthropic API 키가 들어 있음 — 백업 파일에 비밀값을 남기지 않는다),
// 시험지 PDF·사진 같은 Storage 파일(용량이 커서 — 원본 PDF는 원장님 컴퓨터에도 있음).
// 복구: 파일을 열면 { tables: { 테이블이름: [행…] } } 형태라, 필요할 때 이 파일을 주면 SQL로 되살릴 수 있다.

type Client = any;

export const BACKUP_BUCKET = "backups";
const KEEP = 8;
const INTERVAL_MS = 7 * 24 * 3600 * 1000;
const PAGE = 1000;

const TABLES = [
  "profiles",
  "classes",
  "exams",
  "answer_key",
  "item_explanations",
  "exam_corrections",
  "exam_notes",
  "exam_pdf_meta",
  "item_checks",
  "submissions",
  "grading_results",
  "tutor_stats",
  "tutor_points_ledger",
  "tutor_item_reviews",
  "tutor_exam_purchases",
  "tutor_links",
  "tutor_edit_requests",
  "tutor_review_skips",
  "exam_jobs",
  "digitize_jobs",
  "digitized_pages",
  "item_locate_jobs",
  "ai_usage",
  "bug_reports", // 0026 과외선생님 버그 신고(0026 전이면 요약에 오류로만 표시)
  "student_numbers", // 0036 학번(관리자 전용) — 백업 파일도 관리자만 받는다
  "tutor_gold_attempts", // 0037 정답 아는 문항 풀이 기록
  "tutor_judgments", // 0037 정답률(맞음/틀림) 기록
  "student_keys", // 0039 학생 합치기·숨기기·상담 메모
  "tutor_worksheets", // 0042 과외선생님 맞춤 시험지
  "tutor_worksheet_items", // 0042 맞춤 시험지로 받은 문항(정답 아는 문항 배정에서 뺌)
  "tutor_invite_codes", // 0046 친구 초대 코드
  "tutor_referrals", // 0046 누가 누구를 초대했는지
  "placement_tests", // 0047 입학테스트
  "placement_submissions", // 0047 입학테스트 학생 제출
];

// id 열이 없는 표의 기본키(마이그레이션 기준)
const KEY_COLS: Record<string, string[]> = {
  exam_pdf_meta: ["exam_id"],
  item_checks: ["exam_id", "item_label"],
  tutor_stats: ["tutor_id"],
  tutor_links: ["tutor_id"],
  tutor_review_skips: ["tutor_id", "item_explanation_id"],
  exam_jobs: ["exam_id"],
  digitize_jobs: ["exam_id"],
  item_locate_jobs: ["exam_id"],
  tutor_worksheet_items: ["tutor_id", "item_explanation_id"],
  tutor_invite_codes: ["tutor_id"],
  tutor_referrals: ["invitee_id"],
  student_numbers: ["user_id"],
  student_keys: ["key"],
};

async function dumpTable(client: Client, table: string): Promise<{ rows: any[]; error?: string }> {
  const rows: any[] = [];
  // 페이지로 나눠 읽을 때 순서가 흔들리지 않게 기본키 순으로 읽는다. id 열이 없는 표는 KEY_COLS의 기본키로
  // (2026-09-29: 전에는 id 없는 표를 순서 없이 나눠 읽어, 1000줄이 넘으면 줄이 겹치거나 빠질 수 있었다).
  const keyCols = KEY_COLS[table] ?? ["id"];
  let ordered = true;
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select("*").range(from, from + PAGE - 1);
    if (ordered) for (const c of keyCols) q = q.order(c, { ascending: true });
    let { data, error } = await q;
    if (error && ordered && from === 0) {
      ordered = false;
      ({ data, error } = await client.from(table).select("*").range(from, from + PAGE - 1));
    }
    if (error) return { rows, error: String(error.message || error) };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    if (rows.length > 500_000) return { rows, error: "행이 너무 많아 중간에서 멈춤" };
  }
  return { rows };
}

export type BackupFile = { name: string; size: number; createdAt: string };

export async function listBackups(client: Client): Promise<BackupFile[]> {
  const { data, error } = await client.storage.from(BACKUP_BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) return [];
  return ((data as any[]) ?? [])
    .filter((f) => /\.json\.gz$/.test(f.name))
    .map((f) => ({ name: f.name, size: Number(f.metadata?.size ?? 0), createdAt: String(f.created_at ?? "") }));
}

/** 지금 백업을 만든다. 만든 파일 이름과 테이블별 행 수(오류 포함)를 돌려준다. */
export async function runBackup(client: Client): Promise<{ ok: boolean; name?: string; summary: Record<string, number | string>; msg?: string }> {
  const tables: Record<string, any[]> = {};
  const summary: Record<string, number | string> = {};
  for (const t of TABLES) {
    const { rows, error } = await dumpTable(client, t);
    tables[t] = rows;
    summary[t] = error ? `오류: ${error}` : rows.length;
  }
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString(); // 파일 이름은 한국 시각
  const name = `${kst.slice(0, 10)}_${kst.slice(11, 13)}${kst.slice(14, 16)}.json.gz`;
  const body = gzipSync(Buffer.from(JSON.stringify({ app: "medicchart", version: 1, createdAt: now.toISOString(), summary, tables })));
  const { error } = await client.storage.from(BACKUP_BUCKET).upload(name, body, { contentType: "application/gzip", upsert: true });
  if (error) return { ok: false, summary, msg: "백업 파일을 저장하지 못했습니다: " + error.message + " (0025 마이그레이션을 실행했는지 확인해 주세요)" };

  // 오래된 백업 정리(최근 KEEP개만)
  const all = await listBackups(client);
  const old = all.slice(KEEP).map((f) => f.name);
  if (old.length) await client.storage.from(BACKUP_BUCKET).remove(old);
  return { ok: true, name, summary };
}

/** 마지막 백업이 7일 이상 지났으면(또는 없으면) 백업한다. 크론에서 호출. 백업했으면 파일 이름. */
export async function runBackupIfDue(client: Client): Promise<string | null> {
  const { data, error } = await client.storage.from(BACKUP_BUCKET).list("", { limit: 1, sortBy: { column: "name", order: "desc" } });
  if (error) return null; // 0025 전(버킷 없음)
  const latest = ((data as any[]) ?? []).find((f) => /\.json\.gz$/.test(f.name));
  const last = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
  if (last && Date.now() - last < INTERVAL_MS) return null;
  const r = await runBackup(client);
  return r.ok ? r.name ?? null : null;
}

/** 관리자 다운로드용 임시 링크(10분) */
export async function backupDownloadUrl(client: Client, name: string): Promise<string | null> {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.json\.gz$/.test(name)) return null;
  const { data, error } = await client.storage.from(BACKUP_BUCKET).createSignedUrl(name, 600, { download: `medicchart_backup_${name}` });
  if (error) return null;
  return data?.signedUrl ?? null;
}
