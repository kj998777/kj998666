// 고3 사설 모의고사 문항 ↔ 같은 아이디어의 평가원 기출(0057 mock_gichul_links) — 2026-10-12 원장님
// "어떤 기출문제에서 나왔던 아이디어를 출제한 것인지" → "4점 문항만, 사이트에 등록".
// 시험 화면(대응표·수정), 보고서(문항표에 출처, 틀린·빈 문항에 기출 그림)가 함께 쓰는 순수 함수 모음(test/gichulLinks.test.ts).

export type GichulLink = {
  id?: string;
  label: string;
  rank: number;
  /** 예: "2026학년도 수능 공통 21번" */
  source: string;
  /** 공통 아이디어 한 줄 */
  idea: string;
  /** 기출 문제 그림(PNG/JPEG data URL) — 없을 수 있음 */
  image: string | null;
};

export type GichulMap = Record<string, GichulLink[]>;

export const GICHUL_SOURCE_MAX = 120;
export const GICHUL_IDEA_MAX = 300;
/** 그림 data URL 최대 길이(약 500KB) — DB 제약(0057)보다 조금 작게 */
export const GICHUL_IMAGE_MAX = 680_000;

const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** 입력 한 줄을 다듬는다 — 출처가 비면 null */
export function cleanGichulInput(v: {
  label?: unknown;
  rank?: unknown;
  source?: unknown;
  idea?: unknown;
  image?: unknown;
}): GichulLink | null {
  const label = String(v.label ?? "").normalize("NFC").trim();
  const source = String(v.source ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, GICHUL_SOURCE_MAX);
  const idea = String(v.idea ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, GICHUL_IDEA_MAX);
  if (!label || !source) return null;
  const r = Math.round(Number(v.rank));
  const rank = Number.isFinite(r) && r >= 1 && r <= 9 ? r : 1;
  const img = typeof v.image === "string" ? v.image.trim() : "";
  const image = img && img.length <= GICHUL_IMAGE_MAX && IMAGE_RE.test(img) ? img : null;
  return { label, rank, source, idea, image };
}

/** DB 행들을 문항별로 묶고 rank 순으로 정렬 */
export function groupGichul(
  rows: { id?: string; item_label: string; rank: number | null; source: string; idea: string | null; image?: string | null }[]
): GichulMap {
  const out: GichulMap = {};
  for (const r of rows ?? []) {
    const label = String(r.item_label ?? "");
    if (!label || !r.source) continue;
    (out[label] ??= []).push({
      id: r.id,
      label,
      rank: Number(r.rank) || 1,
      source: String(r.source),
      idea: String(r.idea ?? ""),
      image: r.image ?? null,
    });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.rank - b.rank);
  return out;
}

/** 한꺼번에 넣기용 JSON — [{label, source, idea, image?, rank?}, ...] 또는 {links: [...]} */
export function parseGichulImport(text: string): { links: GichulLink[]; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽지 못했습니다.");
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.links) ? (raw as any).links : null;
  if (!arr) throw new Error("기출 연결 목록(links)이 없습니다.");
  const links: GichulLink[] = [];
  let skipped = 0;
  const nextRank: Record<string, number> = {};
  for (const x of arr) {
    const c = cleanGichulInput(x ?? {});
    if (!c) {
      skipped++;
      continue;
    }
    // rank가 없으면 문항별로 1, 2, 3… 순서대로
    if ((x as any)?.rank == null) c.rank = (nextRank[c.label] = (nextRank[c.label] ?? 0) + 1);
    links.push(c);
  }
  return { links, skipped };
}

/** 보고서 문항표 칸에 넣을 짧은 출처 글 — 가장 가까운 짝(rank 1) 출처 + "외 N개" */
export function gichulCellText(list: GichulLink[] | undefined): string {
  if (!list?.length) return "";
  return list[0].source + (list.length > 1 ? ` 외 ${list.length - 1}개` : "");
}
