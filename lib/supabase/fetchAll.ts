// Supabase(PostgREST)는 한 번 조회에 최대 1000줄만 돌려주고, 넘치는 줄은 오류 없이 조용히 잘라 버린다.
// 또 .in("id", [...]) 에 id를 수백 개 넣으면 요청 주소가 너무 길어져 실패할 수 있다.
//
// 2026-09-29 야간 점검: 문항 영역 찾기에서 이 제한 때문에 일부 시험이 통째로 빠지는 버그가 실제로 나왔고, 같은 모양의
// 조회가 검토현황·시험 목록·기출 스토어 등에도 있었다. 시험·문항이 늘어나면 화면에서 시험이 말없이 사라지거나
// (검토현황), 스토어에서 PDF가 있는 시험이 "PDF 준비 중"으로 보이는 식으로 드러난다. 그런 조회는 이 도우미로 읽는다.
//
// 주의: 나눠 읽을 때 순서가 매번 같아야 줄이 겹치거나 빠지지 않으므로, make 안에서 반드시 .order(...)를 걸 것
// (가능하면 id 같은 고유한 열로).

type Res = { data: any[]; error: any };

const PAGE = 1000;
const MAX_ROWS = 200_000; // 안전장치

/** make(from, to)로 1000줄씩 끝까지 읽는다. make는 .range(from, to)를 붙인 쿼리를 돌려줘야 한다. */
export async function fetchAllPages(make: (from: number, to: number) => any): Promise<Res> {
  const out: any[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = (await make(from, from + PAGE - 1)) as any;
    if (error) return { data: out, error };
    const rows = (data as any[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}

/**
 * ids를 조각(기본 150개)으로 나눠 .in(...) 조회를 하고, 조각마다 1000줄씩 끝까지 읽어 합친다.
 * make(chunk, from, to)는 .in(열, chunk)와 .order(...)와 .range(from, to)를 붙인 쿼리를 돌려줘야 한다.
 */
export async function fetchAllIn(
  ids: string[],
  make: (chunk: string[], from: number, to: number) => any,
  chunkSize = 150
): Promise<Res> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out: any[] = [];
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const r = await fetchAllPages((from, to) => make(chunk, from, to));
    out.push(...r.data);
    if (r.error) return { data: out, error: r.error };
  }
  return { data: out, error: null };
}
