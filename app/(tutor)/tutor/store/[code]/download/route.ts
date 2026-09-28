import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStampedExamPdf, type Correction } from "@/lib/ai/pdfStamp";
import { ensureTutorLinkToken, tutorSubmitPath } from "@/lib/tutor/link";
import { contentDispositionAttachment } from "@/lib/http/contentDisposition";
import { personLabel } from "@/lib/profile/label";

export const dynamic = "force-dynamic";

// 기출 스토어 "다운로드" — purchase_exam_download RPC로 이미 구매(포인트 차감)한 시험만 통과시킨다.
// 이 GET 라우트 자체는 조회만 하고 아무것도 차감하지 않으므로 몇 번을 다시 받아도 안전.
//
// #4 (2026-09-28): 원본 PDF를 그대로 주던 것을, 앞에 메딕수학 표지·뒤에 메딕수학 로고 + 이 과외선생님
// 전용 답안 제출 QR(/s/코드?t=토큰)을 반드시 붙여서 준다(정오표가 있으면 QR 쪽 앞에 함께).
// 과외선생님은 exam-pdfs 버킷·정오표 테이블 RLS를 통과하지 못하므로, 구매 확인 뒤 서비스롤로 읽는다.
export async function GET(request: Request, { params }: { params: { code: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase
    .from("exams")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle()) as any;
  if (!exam) {
    return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: purchase } = (await supabase
    .from("tutor_exam_purchases")
    .select("id")
    .eq("exam_id", exam.id)
    .eq("tutor_id", auth.session.userId)
    .maybeSingle()) as any;
  if (!purchase) {
    return Response.json({ ok: false, msg: "이 시험을 아직 구매하지 않았습니다." }, { status: 403 });
  }

  let token: string;
  try {
    token = await ensureTutorLinkToken(auth.session.userId);
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "제출 링크를 만들지 못했습니다." }, { status: 500 });
  }
  const submitUrl = new URL(request.url).origin + tutorSubmitPath(exam.code, token);

  const admin = createAdminClient();
  const { data: correctionRows } = (await admin
    .from("exam_corrections")
    .select("item_label, issue, fix")
    .eq("exam_id", exam.id)
    .order("item_label")) as any;
  const fixes: Correction[] = ((correctionRows as any[]) ?? []).map((c) => ({
    label: c.item_label,
    issue: c.issue ?? "",
    fix: c.fix ?? "",
  }));

  // 받은 사람 표시(2026-09-28 원장님 요청 3): 모든 쪽 아래에 "30기 홍길동 선생님 전용 · 날짜"를 옅게.
  // 외부 유출을 막고, 유출되더라도 누가 받은 파일인지 알 수 있게 한다. 이름·기수(0021)가 없으면 이메일.
  const { data: me } = (await admin
    .from("profiles")
    .select("*")
    .eq("id", auth.session.userId)
    .maybeSingle()) as any;
  const who = personLabel({ display_name: me?.display_name, cohort: me?.cohort, email: me?.email ?? auth.session.email });
  const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replace(/\s/g, "")
    .replace(/\.$/, "");
  const watermark = `메딕차트 · ${who} 선생님 전용 · ${today} · 무단 배포 금지`;

  let bytes: Uint8Array;
  try {
    bytes = await buildStampedExamPdf(admin, exam.id, {
      cover: true,
      addFixPage: true,
      excludePages: [],
      // #7: 뒤에 붙은 정답·해설·OMR 쪽은 빼고 문제만(과외선생님 배포용이라 항상)
      autoTrimAnswerPages: true,
      examName: exam.name,
      examCode: exam.code,
      submitUrl,
      fixes,
      watermark,
    });
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "PDF를 만들지 못했습니다." }, { status: 404 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(`${exam.name}_${exam.code}.pdf`, `exam_${exam.id}.pdf`),
      "Cache-Control": "no-store",
    },
  });
}
