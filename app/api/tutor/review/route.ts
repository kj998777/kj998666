import { NextResponse } from "next/server";
import { requireTutorApi } from "@/lib/auth/requireTutor";
import {
  claimNextReviewItem,
  releaseReviewClaim,
  submitPrimaryReview,
  submitVerification,
} from "@/app/(tutor)/tutor/review/actions";

// 과외선생님 검토(제출·다음 문항 받기·포기)를 고정된 주소로 받는다(2026-09-29 원장님 제보).
//
// 전에는 화면의 버튼이 Next 서버 액션을 직접 불렀는데, 서버 액션은 배포할 때마다 내부 주소(ID)가 바뀐다. 검토 화면은
// 오래 열어 두고 푸는 화면이라, 푸는 도중에 사이트가 업데이트되면 제출 버튼이 없어진 옛 주소로 보내져
// "사이트가 방금 업데이트돼서 이 화면으로는 보낼 수 없어요"가 떴다(적던 풀이를 들고 새로고침해야 했음).
// 이 라우트는 주소가 바뀌지 않으므로 업데이트 뒤에도 그대로 보낼 수 있다. 실제 처리는 기존 함수(actions.ts)를 그대로 쓴다.
//
// 요청: POST multipart/form-data
//   op=submit  itemExplanationId, kind(primary|verify), answerDisplay, solution, image(선택, 파일)
//   op=next    (다음 문항 배정)
//   op=release itemExplanationId
// 응답: 항상 JSON { ok, msg?, ... }

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return json({ ok: false, msg: "보낸 내용을 읽지 못했어요. 사진이 너무 크면 다른 사진으로 다시 올려 주세요." }, 400);
  }
  const op = String(fd.get("op") ?? "");
  const id = String(fd.get("itemExplanationId") ?? "");
  const validId = /^[0-9a-f-]{36}$/i.test(id);

  try {
    if (op === "submit") {
      if (!validId) return json({ ok: false, msg: "문항 정보가 올바르지 않습니다. 새로고침해 주세요." }, 400);
      const kind = String(fd.get("kind") ?? "primary") === "verify" ? "verify" : "primary";
      const answerDisplay = String(fd.get("answerDisplay") ?? "");
      const solution = String(fd.get("solution") ?? "");
      const img = fd.get("image");
      const image = img instanceof File && img.size > 0 ? img : null;
      const r =
        kind === "verify"
          ? await submitVerification(id, answerDisplay, solution, image)
          : await submitPrimaryReview(id, answerDisplay, solution, image);
      return json(r);
    }
    if (op === "next") {
      const next = await claimNextReviewItem();
      return json({ ok: true, next });
    }
    if (op === "release") {
      if (!validId) return json({ ok: false, msg: "문항 정보가 올바르지 않습니다. 새로고침해 주세요." }, 400);
      await releaseReviewClaim(id);
      return json({ ok: true });
    }
    return json({ ok: false, msg: "알 수 없는 요청입니다." }, 400);
  } catch (e: any) {
    // redirect()(로그인 풀림 등)는 위 requireTutorApi에서 이미 걸러지므로 여기 오는 건 진짜 오류
    console.error("tutor review api failed", op, e);
    return json({ ok: false, msg: "보내는 중 서버에서 문제가 생겼어요. 잠시 후 다시 눌러 주세요. 계속되면 '버그 신고'로 알려 주세요." }, 500);
  }
}
