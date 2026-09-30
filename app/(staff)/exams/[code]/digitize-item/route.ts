import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { redigitizeItem } from "@/lib/ai/digitizeItem";

// 디지털화된 문항 하나만 AI로 다시 읽기(2026-09-30). 서버 액션이 아니라 API 라우트인 이유: AI가 수십 초 걸릴 수 있는데
// 서버 액션은 한 화면에서 줄 서서 실행돼 그동안 화면 이동이 막힌다(poll/route.ts 주석 참고). 결과는 저장하지 않고 돌려준다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMG = 2_500_000; // base64 글자 수(그림 한 장 약 1.8MB)

export async function POST(request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, msg: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  const pageNo = Number(body.pageNo);
  const itemIndex = Number(body.itemIndex);
  if (!Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(itemIndex) || itemIndex < 0)
    return Response.json({ ok: false, msg: "문항 정보가 올바르지 않습니다." }, { status: 400 });
  const page = String(body.page ?? "");
  const zooms: string[] = Array.isArray(body.zooms) ? body.zooms.map(String).slice(0, 2) : [];
  const zoom = body.zoom === "box" ? "box" : "halves";
  for (const s of [page, ...zooms]) {
    if (!s || s.length > MAX_IMG || !B64.test(s)) return Response.json({ ok: false, msg: "보낸 그림이 올바르지 않습니다." }, { status: 400 });
  }
  if (!zooms.length) return Response.json({ ok: false, msg: "확대 그림이 없습니다." }, { status: 400 });

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id").eq("code", code).maybeSingle()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  const { data: row } = (await supabase
    .from("digitized_pages")
    .select("data")
    .eq("exam_id", exam.id)
    .eq("page_no", pageNo)
    .maybeSingle()) as any;
  const item = row?.data?.items?.[itemIndex];
  if (!item || item.type !== "question") return Response.json({ ok: false, msg: "문항을 찾지 못했습니다. 새로고침해 주세요." }, { status: 404 });

  try {
    const r = await redigitizeItem(supabase, { pageNo, item, images: { page, zooms, zoom }, hint: String(body.hint ?? "") });
    return Response.json(r, { status: r.ok ? 200 : 502 });
  } catch (e: any) {
    return Response.json({ ok: false, msg: "다시 읽지 못했습니다: " + String(e?.message ?? e) }, { status: 500 });
  }
}
