import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SignOutButton from "../(staff)/SignOutButton";
import RefreshButton from "./RefreshButton";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";

// #6: 자율 가입(회원가입) 계정의 기본 역할 '대기'가 도착하는 화면. 관리자가 계정 관리 화면에서
// 알맞은 권한으로 바꿔줄 때까지는 아무 것도 할 수 없고, 이 안내와 로그아웃 버튼만 볼 수 있다.
// admin/editor/viewer/tutor 계정이 실수로 여기 들어오면 각자의 홈으로 돌려보낸다.
// 2026-09-29 원장님 요청: 가입 때 적은 이메일·과·기수(학번)·이름을 원장님 카카오톡으로 보내 달라는 안내 + 복사 버튼,
// 원장님 카카오톡 오픈채팅(링크·링크로 만든 QR, 계정 관리에서 설정 — 0033 site_contact)을 함께 보여 준다.
export default async function PendingPage() {
  const session = await getSessionAndRole();
  if (!session) redirect("/login");
  if (session.role === "tutor") redirect("/tutor/dashboard");
  if (session.role === "admin" || session.role === "editor" || session.role === "viewer") redirect("/dashboard");

  // 내 가입 정보(과 열이 아직 없으면 이름·기수만)
  const admin = createAdminClient();
  let prof: any = null;
  {
    const r = (await admin.from("profiles").select("display_name, cohort, department").eq("id", session.userId).maybeSingle()) as any;
    prof = r.error ? ((await admin.from("profiles").select("display_name, cohort").eq("id", session.userId).maybeSingle()) as any).data : r.data;
  }
  const dept: string = prof?.department ?? "";
  const cohortLabel = dept && dept !== "의대" ? "학번" : "기수";
  const lines = [
    "[메딕차트 가입 승인 요청]",
    `이메일: ${session.email}`,
    ...(dept ? [`과: ${dept}`] : []),
    ...(prof?.cohort ? [`${cohortLabel}: ${prof.cohort}`] : []),
    ...(prof?.display_name ? [`이름: ${prof.display_name}`] : []),
  ];
  const message = lines.join("\n");

  // 원장님 카카오톡(0033 전이면 없음)
  const supabase = await createClient();
  const { data: contact } = (await supabase.from("site_contact").select("kakao_id, kakao_url, kakao_qr, note").maybeSingle()) as any;
  let qr: string | null = contact?.kakao_qr || null;
  if (!qr && contact?.kakao_url) {
    try {
      qr = await QRCode.toDataURL(contact.kakao_url, { margin: 1, width: 320 });
    } catch {
      qr = null;
    }
  }
  const hasContact = !!(contact?.kakao_id || contact?.kakao_url || qr);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="card w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-semibold">대기중인 계정입니다</h1>
          <p className="text-sm text-slate-500">
            아직 이 계정에는 사용 권한이 지정되지 않았습니다. 승인을 받으려면 아래 가입 정보를 <b>원장님 카카오톡 오픈채팅</b>으로
            보내 주세요.
          </p>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-amber-900">① 이 내용을 복사해서</p>
            <CopyButton text={message} label="내용 복사" targetId="pending-msg" />
          </div>
          <pre id="pending-msg" className="whitespace-pre-wrap break-all rounded bg-white px-3 py-2 text-sm text-slate-800 border border-amber-200 font-sans">
            {message}
          </pre>
        </div>

        <div className="rounded-lg border border-yellow-300 bg-[#FEE500]/30 p-3 space-y-3">
          <p className="text-sm font-medium text-slate-900">② 원장님 오픈채팅에 들어가서 붙여 넣어 보내 주세요</p>
          {hasContact ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="원장님 카카오톡 오픈채팅 QR" className="w-40 h-40 object-contain rounded border border-slate-200 bg-white" />
              )}
              <div className="space-y-2 text-sm text-center sm:text-left">
                {contact?.kakao_url && (
                  <a href={contact.kakao_url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg bg-[#FEE500] px-4 py-2 font-medium text-slate-900">
                    오픈채팅으로 보내기
                  </a>
                )}
                {contact?.kakao_id && (
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <span>
                      오픈채팅 대신 카카오톡 ID <b id="kakao-id" className="font-mono">{contact.kakao_id}</b>
                    </span>
                    <CopyButton text={contact.kakao_id} label="ID 복사" targetId="kakao-id" />
                  </div>
                )}
                {qr && <p className="text-xs text-slate-500">컴퓨터로 보고 있다면 휴대폰 카메라로 QR을 찍으면 오픈채팅방이 열립니다.</p>}
                {contact?.note && <p className="text-xs text-slate-600">{contact.note}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">원장님께 카카오톡으로 위 내용을 보내 주세요(오픈채팅 링크 준비 중).</p>
          )}
        </div>

        <p className="text-xs text-slate-500 text-center">승인을 받은 뒤 새로고침을 누르면 바로 들어갈 수 있습니다.</p>
        <div className="flex justify-center gap-2">
          <RefreshButton />
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
