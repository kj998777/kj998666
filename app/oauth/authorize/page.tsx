import { redirect } from "next/navigation";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import { getClient, isStaffRole } from "@/lib/mcp/oauth";
import { authorizeParamsProblem, readAuthorizeParams } from "@/lib/mcp/oauthCore";
import { decideAuthorize } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "메딕차트 연결 허용", robots: { index: false } };

// 메딕차트 MCP 커넥터 승인 화면(0059, 2026-11-07) — claude.ai에서 "연결"을 누르면 여기로 온다.
// 메딕차트에 로그인한 직원(관리자·편집자·열람자)이 "허용"을 누르면 1회용 코드를 claude.ai로 돌려보낸다.
// 연결된 Claude는 그 직원의 권한만큼만 쓸 수 있다(열람자는 읽기만, 편집자는 정답·해설·시험 올리기, 관리자는 열기·닫기까지).

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자", viewer: "열람자" };
const ROLE_CAN: Record<string, string[]> = {
  viewer: ["시험·정답표·문항 해설·제출 결과 보기"],
  editor: ["시험·정답표·문항 해설·제출 결과 보기", "시험 만들기, 문제지·해설지 PDF 올리기", "정답표·해설·등급컷·해설 쪽·시험 정보 고치기"],
  admin: ["시험·정답표·문항 해설·제출 결과 보기", "시험 만들기, 문제지·해설지 PDF 올리기", "정답표·해설·등급컷·해설 쪽·시험 정보 고치기", "시험 제출 열기·닫기"],
};

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="card w-full max-w-md space-y-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const p = readAuthorizeParams(searchParams);
  const problem = authorizeParamsProblem(p);
  if (problem) {
    return (
      <Box title="연결 요청이 올바르지 않습니다">
        <p className="text-sm text-slate-600">{problem} Claude에서 커넥터 연결을 처음부터 다시 시도해 주세요.</p>
      </Box>
    );
  }
  const client = await getClient(p.client_id);
  if (!client || !client.redirect_uris.includes(p.redirect_uri)) {
    return (
      <Box title="등록되지 않은 연결입니다">
        <p className="text-sm text-slate-600">Claude에서 커넥터를 지우고 다시 추가해 주세요.</p>
      </Box>
    );
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, String(v));
  const session = await getSessionAndRole();
  if (!session) redirect("/login?next=" + encodeURIComponent("/oauth/authorize?" + qs.toString()));
  if (!isStaffRole(session.role)) {
    return (
      <Box title="직원 계정만 연결할 수 있습니다">
        <p className="text-sm text-slate-600">
          메딕차트 MCP는 관리자·편집자·열람자 계정만 쓸 수 있습니다. 지금 로그인한 계정({session.email})은 연결할 수 없어요.
        </p>
      </Box>
    );
  }

  const host = new URL(p.redirect_uri).host;
  return (
    <Box title="Claude를 메딕차트에 연결할까요?">
      <p className="text-sm text-slate-600">
        <b>{client.client_name || "Claude"}</b>({host})가 메딕차트에 연결하려고 합니다. 허용하면 Claude가 아래 일을{" "}
        <b>
          {session.email} ({ROLE_LABEL[session.role]})
        </b>{" "}
        계정으로 할 수 있습니다.
      </p>
      <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
        {ROLE_CAN[session.role].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">시험·제출 기록을 지우는 일은 할 수 없습니다. 고친 내용은 모두 기록되고, 관리자 화면(MCP 연결)에서 언제든 연결을 끊을 수 있습니다.</p>
      <form action={decideAuthorize} className="flex gap-2 pt-1">
        {Object.entries(p).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button type="submit" name="decision" value="allow" className="btn-primary flex-1">
          허용
        </button>
        <button type="submit" name="decision" value="deny" className="btn-secondary flex-1">
          거절
        </button>
      </form>
    </Box>
  );
}
