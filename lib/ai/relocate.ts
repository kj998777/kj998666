import "server-only";
import { autoBaseKey, autoLabel } from "./normalize";
import { enqueueLocateJobIfMissing } from "./locate";

// 시험의 원본 PDF가 바뀐 뒤 문항 잘라 보기 좌표(item_explanations.source_page + bbox_*)를 새 PDF에 맞춘다.
//
// 2026-09-29 원장님 제보("문제 캡처가 엉뚱한 곳·다른 번호 문제·쪽 전체로 나온다")의 주원인: 스캔본을 디지털화해
// "원본으로 적용"하면 PDF의 쪽 나눔과 배치가 완전히 바뀌는데, 좌표는 스캔본 기준으로 그대로 남아 있었다.
//  - locations가 있으면(디지털 조판 때 브라우저가 잰 실제 자리, buildDigitizedPdf.ts) 번호로 맞춰 정확히 채운다.
//  - 못 맞춘 문항(또는 locations 없이 PDF만 바뀐 경우)은 옛 좌표를 지우고, 검토 대기 문항이면 AI 영역 찾기를 다시 건다.
// 정답·해설은 건드리지 않는다.

type Client = any;
export type NewPdfLocation = { label: string; page: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

function clean(list: unknown): NewPdfLocation[] {
  if (!Array.isArray(list)) return [];
  const out: NewPdfLocation[] = [];
  for (const v of list.slice(0, 400)) {
    const label = autoLabel((v as any)?.label).slice(0, 30);
    const page = Math.round(Number((v as any)?.page));
    const b = (v as any)?.bbox ?? {};
    const x0 = Number(b.x0), y0 = Number(b.y0), x1 = Number(b.x1), y1 = Number(b.y1);
    if (!label || !(page >= 1 && page <= 500)) continue;
    if (![x0, y0, x1, y1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) || x1 <= x0 || y1 <= y0) continue;
    out.push({ label, page, bbox: { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) } });
  }
  return out;
}

/** 돌려주는 값: 새 자리를 채운 문항 수, 좌표를 지운 문항 수 */
export async function applyNewPdfLocations(
  client: Client,
  examId: string,
  rawLocations: unknown
): Promise<{ matched: number; cleared: number }> {
  const locs = clean(rawLocations);
  const byLabel = new Map<string, NewPdfLocation>();
  const byBase = new Map<string, NewPdfLocation>();
  for (const l of locs) {
    if (!byLabel.has(l.label)) byLabel.set(l.label, l);
    const base = autoBaseKey(l.label);
    if (!byBase.has(base)) byBase.set(base, l);
  }

  const { data: items, error } = (await client
    .from("item_explanations")
    .select("id, item_label, source_page, bbox_x0")
    .eq("exam_id", examId)) as any;
  if (error) throw new Error(error.message);

  let matched = 0;
  let cleared = 0;
  for (const it of (items as any[]) ?? []) {
    const label = autoLabel(it.item_label);
    const loc = byLabel.get(label) ?? byBase.get(autoBaseKey(label)) ?? null;
    const patch = loc
      ? {
          source_page: loc.page,
          bbox_x0: loc.bbox.x0,
          bbox_y0: loc.bbox.y0,
          bbox_x1: loc.bbox.x1,
          bbox_y1: loc.bbox.y1,
        }
      : { source_page: null, bbox_x0: null, bbox_y0: null, bbox_x1: null, bbox_y1: null };
    if (!loc && it.source_page == null && it.bbox_x0 == null) continue; // 지울 것도 없음
    const { error: uErr } = await (client.from("item_explanations") as any).update(patch).eq("id", it.id);
    if (uErr) continue;
    if (loc) matched++;
    else cleared++;
  }
  // 못 맞춘 검토 대기 문항은 새 PDF에서 AI로 영역을 다시 찾게 한다(없으면 아무것도 안 함, 0024 전이면 조용히 건너뜀).
  if (cleared) await enqueueLocateJobIfMissing(client, examId);
  return { matched, cleared };
}
