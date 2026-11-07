import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { TOOLS } from "@/lib/mcp/tools";
import { revokeMcpGrant } from "./actions";

export const dynamic = "force-dynamic";

// 관리자 "Claude 연결(MCP)" 화면(2026-11-07, 0059): claude.ai 커스텀 커넥터로 메딕차트를 연결하는 방법,
// 지금 연결된 직원 계정(연결 단위로 끊기), 최근 도구 사용 기록.

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const ROLE_KO: Record<string, string> = { viewer: "열람자", editor: "편집자", admin: "관리자" };

function shortArgs(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const s = JSON.stringify(a);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

export default async function AdminMcpPage() {
  await requireRole("admin");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "medicchart.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/api/mcp`;

  const admin: any = createAdminClient();
  const nowIso = new Date().toISOString();
  const [{ data: toks, error: tokErr }, { data: logs }] = await Promise.all([
    admin
      .from("mcp_tokens")
      .select("grant_id, user_id, client_id, kind, created_at, last_used_at, expires_at")
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("mcp_audit").select("id, user_id, tool, write, args, ok, message, created_at").order("created_at", { ascending: false }).limit(100),
  ]);

  if (tokErr) {
    return (
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold">Claude 연결(MCP)</h1>
        <p className="text-sm text-slate-600">
          마이그레이션 <code>0059_mcp_connector.sql</code>을 Supabase SQL Editor에서 실행하면 이 화면을 쓸 수 있습니다.
        </p>
      </div>
    );
  }

  // 연결(grant) 단위로 묶기: 살아 있는 refresh가 있으면 연결 중
  const grants = new Map<string, { grant_id: string; user_id: string; client_id: string; since: string; last: string | null; refreshUntil: string | null }>();
  for (const t of (toks ?? []) as any[]) {
    const g = grants.get(t.grant_id) ?? { grant_id: t.grant_id, user_id: t.user_id, client_id: t.client_id, since: t.created_at, last: null, refreshUntil: null };
    if (t.created_at < g.since) g.since = t.created_at;
    if (t.last_used_at && (!g.last || t.last_used_at > g.last)) g.last = t.last_used_at;
    if (t.kind === "refresh" && (!g.refreshUntil || t.expires_at > g.refreshUntil)) g.refreshUntil = t.expires_at;
    grants.set(t.grant_id, g);
  }
  const live = Array.from(grants.values()).filter((g) => g.refreshUntil);

  const userIds = Array.from(new Set([...live.map((g) => g.user_id), ...((logs ?? []) as any[]).map((l) => l.user_id).filter(Boolean)]));
  const clientIds = Array.from(new Set(live.map((g) => g.client_id)));
  const people = new Map<string, { label: string; role: string }>();
  const clients = new Map<string, string>();
  if (userIds.length) {
    const { data: ps } = await admin.from("profiles").select("id, email, display_name, cohort, department, role").in("id", userIds);
    for (const p of (ps as any[]) ?? []) people.set(p.id, { label: personLabel(p), role: p.role });
  }
  if (clientIds.length) {
    const { data: cs } = await admin.from("mcp_oauth_clients").select("client_id, client_name").in("client_id", clientIds);
    for (const c of (cs as any[]) ?? []) clients.set(c.client_id, c.client_name || "Claude");
  }

  const byRole = (r: "viewer" | "editor" | "admin") => TOOLS.filter((t) => t.minRole === r);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Claude 연결(MCP)</h1>
        <p className="text-sm text-slate-500">
          claude.ai(웹·앱·Cowork)에 메딕차트를 커넥터로 붙이면, 대화로 시험을 찾고 모의고사를 올리고 정답표·해설·등급컷을 고칠 수 있습니다. 직원 계정(관리자·편집자·열람자)만 연결되고, 할 수 있는 일은 그 계정의 역할과 같습니다.
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">연결하는 방법</h2>
        <div className="text-sm">
          커넥터 주소
          <div className="mt-1 rounded-md bg-slate-100 px-3 py-2 font-mono text-[13px] break-all select-all">{url}</div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            claude.ai → 설정(Settings) → <b>커넥터(Connectors)</b> → <b>커스텀 커넥터 추가(Add custom connector)</b>
          </li>
          <li>이름은 &ldquo;메딕차트&rdquo;, 주소는 위 커넥터 주소. 고급 설정(OAuth Client ID 등)은 비워 둡니다.</li>
          <li>
            <b>연결(Connect)</b>을 누르면 메딕차트 승인 화면이 열립니다. 메딕차트에 로그인돼 있지 않으면 로그인 후 돌아옵니다 → <b>허용</b>.
          </li>
          <li>대화창의 도구(🔧) 메뉴에서 메딕차트를 켜고 &ldquo;대기고 2학년 시험 찾아줘&rdquo;처럼 말하면 됩니다.</li>
        </ol>
        <p className="text-xs text-slate-500">
          팀·엔터프라이즈 요금제는 조직 관리자가 커넥터를 먼저 추가해야 할 수 있습니다. 연결은 60일 동안 쓰지 않으면 끊기고, 아래 표에서 언제든 끊을 수 있습니다. 직원 계정이 아니게 되면(역할 변경) 바로 막힙니다.
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">도구</h2>
        <p className="text-xs text-slate-500">지우는 도구는 없습니다. 모든 호출은 아래 &ldquo;최근 사용 기록&rdquo;에 남습니다. 도구는 AI를 부르지 않습니다(크레딧 안 씀).</p>
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          {(["viewer", "editor", "admin"] as const).map((r) => (
            <div key={r}>
              <div className="mb-1 text-xs font-semibold text-slate-500">{r === "viewer" ? "열람자 이상" : r === "editor" ? "편집자 이상" : "관리자만"}</div>
              <ul className="space-y-0.5">
                {byRole(r).map((t) => (
                  <li key={t.name}>
                    {t.title} <span className="font-mono text-[11px] text-slate-400">{t.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">연결된 계정 ({live.length})</h2>
        {live.length === 0 ? (
          <p className="text-sm text-slate-500">아직 연결된 계정이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3">계정</th>
                  <th className="py-1 pr-3">역할</th>
                  <th className="py-1 pr-3">앱</th>
                  <th className="py-1 pr-3">연결</th>
                  <th className="py-1 pr-3">마지막 사용</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {live.map((g) => {
                  const p = people.get(g.user_id);
                  return (
                    <tr key={g.grant_id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3">{p?.label || "알 수 없는 계정"}</td>
                      <td className="py-1.5 pr-3">{ROLE_KO[p?.role ?? ""] ?? p?.role ?? "—"}</td>
                      <td className="py-1.5 pr-3">{clients.get(g.client_id) ?? "Claude"}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmt(g.since)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmt(g.last)}</td>
                      <td className="py-1.5 text-right">
                        <form action={revokeMcpGrant}>
                          <input type="hidden" name="grant_id" value={g.grant_id} />
                          <button className="btn btn-secondary px-2 py-1 text-xs">끊기</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">최근 사용 기록</h2>
        {!logs?.length ? (
          <p className="text-sm text-slate-500">기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3">시각</th>
                  <th className="py-1 pr-3">계정</th>
                  <th className="py-1 pr-3">도구</th>
                  <th className="py-1 pr-3">결과</th>
                  <th className="py-1">인자</th>
                </tr>
              </thead>
              <tbody>
                {(logs as any[]).map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{fmt(l.created_at)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{people.get(l.user_id)?.label || "—"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {TOOLS.find((t) => t.name === l.tool)?.title ?? l.tool}
                      {l.write && <span className="badge ml-1 bg-amber-100 text-amber-800">쓰기</span>}
                    </td>
                    <td className="py-1.5 pr-3">{l.ok ? <span className="text-emerald-700">성공</span> : <span className="text-red-700">{l.message || "실패"}</span>}</td>
                    <td className="py-1.5 font-mono text-[11px] text-slate-500 break-all">{shortArgs(l.args)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
