import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import WsBuilder from "./WsBuilder";

export const dynamic = "force-dynamic";

// 내가 만든 맞춤 시험지 하나 — 시험지·정답 해설지 PDF 받기(몇 번이든 무료).
export default async function TutorWorksheetDetail({ params }: { params: { id: string } }) {
  const session = await requireTutor();
  const supabase = await createClient();
  const { data: ws } = /^[0-9a-f-]{36}$/i.test(params.id)
    ? ((await (supabase.from("tutor_worksheets") as any).select("id, tutor_id, title, item_ids, points_spent, created_at").eq("id", params.id).maybeSingle()) as any)
    : { data: null };
  if (!ws || ws.tutor_id !== session.userId) {
    return (
      <div className="card space-y-2">
        <p className="text-sm text-red-600">시험지를 찾을 수 없습니다.</p>
        <Link href="/tutor/worksheet" className="link-accent text-sm">
          맞춤 시험지로
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/tutor/worksheet" className="text-sm link-accent">
        ← 맞춤 시험지
      </Link>
      <div className="card space-y-1">
        <h1 className="text-lg font-semibold">{ws.title || "맞춤 시험지"}</h1>
        <p className="text-sm text-slate-500 tabular-nums">
          {(ws.item_ids as string[]).length}문항 · {ws.points_spent}P · {new Date(ws.created_at).toLocaleString("ko-KR")}에 만듦
        </p>
      </div>
      <WsBuilder id={ws.id} defaultTitle={ws.title || "맞춤 시험지"} />
    </div>
  );
}
