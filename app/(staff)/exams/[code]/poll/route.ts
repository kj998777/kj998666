import { pollAiJob } from "../../ai-actions";
import { pollDigitizeAction } from "../digitize-actions";
import { pollErrorCheckAction } from "../error-actions";

// 진행 상황 확인(AI 자동 처리·스캔본 디지털화·출제오류 검사) — 화면이 몇 초마다 부른다. 부를 때마다 작업이 한 걸음 진행된다.
//
// 2026-09-29 최적화: 전에는 이 확인을 서버 액션으로 불렀는데, 서버 액션은 한 화면에서 하나씩 줄 서서 실행되고
// 화면 이동(메뉴 클릭)도 그 줄 뒤에서 기다린다. 한 번의 확인이 AI를 부르느라 수십 초 걸리면 그동안 메뉴를 눌러도
// 화면이 안 바뀌어 "버벅인다"는 느낌의 큰 원인이었다. 일반 API 라우트(fetch)로 옮겨 화면 이동과 따로 돌게 한다.
// 권한 검사는 각 poll 함수 안의 requireRole("admin")이 그대로 한다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);
  let body: { kind?: string; label?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* 빈 요청 */
  }
  try {
    if (body.kind === "ai") return Response.json({ ok: true, data: await pollAiJob(code) });
    if (body.kind === "digitize") return Response.json({ ok: true, data: await pollDigitizeAction(code) });
    if (body.kind === "errcheck" && typeof body.label === "string")
      return Response.json({ ok: true, data: await pollErrorCheckAction(code, body.label) });
    return Response.json({ ok: false, msg: "알 수 없는 요청입니다." }, { status: 400 });
  } catch (e: any) {
    // requireRole의 redirect(로그인 만료 등)는 그대로 다시 던져 Next가 처리하게 한다
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    console.error("poll failed", e);
    return Response.json({ ok: false, msg: "확인하지 못했습니다." }, { status: 500 });
  }
}
