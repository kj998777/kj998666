import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { LEGAL } from "@/lib/legal";

// 개인정보처리방침·이용약관 공통 틀. 공개 전(LEGAL.PUBLISHED=false)에는 관리자만 미리보기로 본다.
export type LegalContact = { kakaoId: string | null; kakaoUrl: string | null };

export async function legalGate(): Promise<{ preview: boolean; contact: LegalContact }> {
  let preview = false;
  if (!LEGAL.PUBLISHED) {
    const s = await getSessionAndRole();
    if (s?.role !== "admin") notFound();
    preview = true;
  }
  let contact: LegalContact = { kakaoId: null, kakaoUrl: null };
  try {
    // 로그인 안 한 사람도 보는 화면이라 서비스롤로 연락처(카카오톡 ID·링크)만 읽는다
    const { data } = (await (createAdminClient().from("site_contact") as any).select("kakao_id, kakao_url").maybeSingle()) as any;
    contact = { kakaoId: data?.kakao_id ?? null, kakaoUrl: data?.kakao_url ?? null };
  } catch {
    /* 연락처가 없으면 안내 문구만 */
  }
  return { preview, contact };
}

export function ContactLine({ contact }: { contact: LegalContact }) {
  if (!contact.kakaoId && !contact.kakaoUrl) return <>가입 대기 화면에 안내된 카카오톡으로 연락해 주세요.</>;
  return (
    <>
      카카오톡{contact.kakaoId ? ` ID ${contact.kakaoId}` : ""}
      {contact.kakaoUrl && (
        <>
          {" "}
          (
          <a href={contact.kakaoUrl} className="link-accent break-all" target="_blank" rel="noreferrer">
            {contact.kakaoUrl}
          </a>
          )
        </>
      )}
    </>
  );
}

export default function LegalShell({
  title,
  preview,
  other,
  children,
}: {
  title: string;
  preview: boolean;
  other: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <Link href="/login" className="flex items-center gap-2">
            <span className="brand-mark">메딕차트</span>
          </Link>
          <Link href={other.href} className="link-accent">
            {other.label}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        {preview && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>시행 전 미리보기</b> — 원장님(관리자)에게만 보입니다. 내용을 확인하신 뒤 공개하면 누구나 볼 수 있고, 회원가입 화면에 동의
            체크가 생깁니다. 법률 문서이니 가능하면 전문가 확인을 받아 주세요. ({LEGAL.VERSION})
          </div>
        )}
        <article className="card space-y-4 text-sm leading-7 text-slate-800 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mt-2 [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {children}
          <p className="text-xs text-slate-500">
            시행일: {LEGAL.EFFECTIVE_DATE || "(공개할 때 적습니다)"} · 운영: {LEGAL.OPERATOR}
          </p>
        </article>
      </main>
    </div>
  );
}
