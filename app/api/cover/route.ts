import { readFile } from "fs/promises";
import path from "path";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { renderCoverPng } from "@/lib/ai/canvasStamp";

export const dynamic = "force-dynamic";

// 2026-10-01 원장님: 입학테스트·문항 은행(학원 문항 은행, 과외 맞춤 시험지)으로 만든 시험지에도 앞뒤 표지.
// 시험지는 브라우저에서 만들지만 표지는 기출 다운로드와 똑같은 그림(서버 @napi-rs/canvas, lib/ai/canvasStamp.ts)을 쓰려고
// 그림만 여기서 그려 준다. ?kind=front&type=placement|worksheet&title=… → 앞 표지 PNG, ?kind=logo → 학원 로고 PNG(뒤 표지용).
// 시험 내용은 들어가지 않으므로(제목 글자만) 로그인한 편집자·관리자·과외선생님이면 된다.
const LOGO_PATH = path.join(process.cwd(), "assets", "branding", "logo.png");
const A4: [number, number] = [595.28, 841.89];

export async function GET(request: Request) {
  const s = await getSessionAndRole();
  if (!s || !(s.role === "admin" || s.role === "editor" || s.role === "tutor")) {
    return Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 });
  }
  const u = new URL(request.url);
  const headers = { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" };
  if (u.searchParams.get("kind") === "logo") {
    return new Response((await readFile(LOGO_PATH)) as any, { headers });
  }
  const title = String(u.searchParams.get("title") ?? "").slice(0, 80);
  const placement = u.searchParams.get("type") === "placement";
  const png = await renderCoverPng(title, A4[0], A4[1], placement ? { title: "입학 진단 평가", badge: "실력 진단", qr: true } : { title: "기출 맞춤 문제지", badge: "내신 대비", qr: false });
  return new Response(png as any, { headers });
}
