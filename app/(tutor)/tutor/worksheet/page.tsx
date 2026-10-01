import Link from "next/link";
import { ScopePickerForm, type ScopeValue } from "@/app/_components/ScopePicker";
import { buildTree } from "@/lib/curriculum/units";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTutorBank, strip } from "@/lib/bank/tutorLoad";
import { DIFFS, facets, parseFilter, search } from "@/lib/bank/search";
import TutorWsResults from "./TutorWsResults";
import TutorWsCart from "./TutorWsCart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 30;

// 과외선생님 맞춤 시험지(2026-09-30 원장님 요청 — 포인트 쓸 곳). 기출 스토어에 있는 시험의 문항을 단원·난이도·학교로 찾아 담고,
// 포인트를 써서 새 시험지 + 정답·해설지 PDF를 만든다. 이미 산 시험의 문항은 무료.
export default async function TutorWorksheetPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requireTutor();
  const f = { ...parseFilter(searchParams), all: true };
  const page = Math.max(1, Number(Array.isArray(searchParams.p) ? searchParams.p[0] : searchParams.p) || 1);
  const supabase = await createClient();
  const [{ items, price }, { data: stats }, { data: mine }] = await Promise.all([
    loadTutorBank(createAdminClient(), session.userId),
    supabase.from("tutor_stats").select("points_balance").eq("tutor_id", session.userId).maybeSingle(),
    (supabase.from("tutor_worksheets") as any).select("id, title, item_ids, points_spent, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const found = search(items, f);
  const fc = facets(items, f);
  const tree = buildTree(items);
  const initialScope: ScopeValue = {
    level: f.level === "중" || f.level === "고" ? f.level : "",
    grade: f.level && f.grade ? Number(f.grade) : null,
    course: f.grade ? f.course ?? "" : "",
    units: f.grade && f.units ? f.units : null,
  };
  const pages = Math.max(1, Math.ceil(found.length / PAGE));
  const rows = found.slice((page - 1) * PAGE, page * PAGE).map(strip);
  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "p") continue;
      for (const x of Array.isArray(v) ? v : v ? [v] : []) u.append(k, x);
    }
    for (const [k, v] of Object.entries(over)) {
      u.delete(k);
      if (v) u.set(k, v);
    }
    const s = u.toString();
    return s ? `/tutor/worksheet?${s}` : "/tutor/worksheet";
  };
  const balance = Number((stats as any)?.points_balance ?? 0);
  const worksheets = ((mine as any[]) ?? []) as { id: string; title: string; item_ids: string[]; points_spent: number; created_at: string }[];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">맞춤 시험지</h1>
        <p className="text-sm text-slate-500">
          기출 스토어에 있는 시험의 문항을 단원·난이도·학교로 찾아 담고, 포인트로 <b>새 시험지와 정답·해설지 PDF</b>를 만듭니다. 문제는 원래
          시험지에서 그 문항 자리를 오려 붙여서 그림·표·보기가 그대로 나옵니다. 값은 시험마다 <b>문항 2개에 1P</b>(그 시험 다운로드 가격보다
          비싸지 않게), <b>이미 산 시험의 문항은 무료</b>입니다. 한 번 만든 시험지는 아래 목록에서 언제든 다시 받을 수 있어요.
        </p>
      </div>

      {/* 2026-10-01: 입학테스트(0047) — 새로 맡은 학생 실력 보기 */}
      <Link
        href="/tutor/placement"
        className="card flex flex-wrap items-center justify-between gap-2 border-violet-200 bg-violet-50/60 hover:border-violet-400"
      >
        <div>
          <p className="font-medium text-violet-900">입학테스트 만들기</p>
          <p className="text-sm text-violet-900/80">
            학년·과목·단원만 고르면 10문항을 자동으로 골라 줍니다. 학생이 QR로 답을 내면 바로 채점되고 진단 보고서(약한 단원·추천 수업 단계)가 나와요.
          </p>
        </div>
        <span className="btn-primary whitespace-nowrap">입학테스트 →</span>
      </Link>

      {worksheets.length > 0 && (
        <div className="card space-y-1">
          <h2 className="font-medium text-sm">내가 만든 시험지</h2>
          <ul className="text-sm divide-y divide-slate-100">
            {worksheets.map((w) => (
              <li key={w.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                <Link href={`/tutor/worksheet/${w.id}`} className="link-accent">
                  {w.title || "맞춤 시험지"}
                </Link>
                <span className="text-xs text-slate-500 tabular-nums">
                  {w.item_ids.length}문항 · {w.points_spent}P · {new Date(w.created_at).toLocaleDateString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div className="space-y-4 min-w-0">
          <form method="get" action="/tutor/worksheet" className="card space-y-3">
            <div className="flex flex-wrap gap-2">
              <input name="q" defaultValue={f.q ?? ""} className="input flex-1 min-w-[12rem]" placeholder="문제 글·단원·학교 이름으로 찾기 (예: 근과 계수)" />
              <button className="btn-primary" type="submit">
                찾기
              </button>
            </div>
            {/* 2026-10-01: 범위 — 학교급 → 학년 → 과목 → 출제할 단원(대단원·중단원 체크) */}
            <ScopePickerForm tree={tree} initial={initialScope} />
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
              <select name="year" defaultValue={f.year ?? ""} className="input" aria-label="연도">
                <option value="">모든 연도</option>
                {fc.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select name="type" defaultValue={f.type ?? ""} className="input" aria-label="유형">
                <option value="">객관식·주관식</option>
                <option value="객관식">객관식</option>
                <option value="주관식">주관식</option>
              </select>
              <input name="unit" defaultValue={f.unit ?? ""} list="tws-units" className="input col-span-2" placeholder="단원(일부만 적어도 됨)" />
              <datalist id="tws-units">
                {fc.units.map((u) => (
                  <option key={u.name} value={u.name}>{`${u.n}문항`}</option>
                ))}
              </datalist>
              <input name="school" defaultValue={f.school ?? ""} className="input col-span-2" placeholder="학교·시험 이름(예: 제주여고)" />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-slate-500">난이도</span>
              {DIFFS.map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="diff" value={d} defaultChecked={!!f.diff?.includes(d)} />
                  {d} <span className="text-xs text-slate-400">{fc.diffs[d] ?? 0}</span>
                </label>
              ))}
              <label className="flex items-center gap-1">
                <input type="checkbox" name="jeju" value="1" defaultChecked={!!f.jeju} />
                제주 학교만
              </label>
              <button className="btn-primary py-1 px-3" type="submit">
                이 조건으로 찾기
              </button>
              <Link href="/tutor/worksheet" className="text-slate-500 hover:underline">
                조건 지우기
              </Link>
            </div>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              찾은 문항 <b>{found.length}</b>개{pages > 1 ? ` · ${page}/${pages}쪽` : ""}
            </span>
            {pages > 1 && (
              <span className="flex gap-2">
                {page > 1 && (
                  <Link className="btn-secondary py-1 px-3" href={qs({ p: String(page - 1) })}>
                    ← 이전
                  </Link>
                )}
                {page < pages && (
                  <Link className="btn-secondary py-1 px-3" href={qs({ p: String(page + 1) })}>
                    다음 →
                  </Link>
                )}
              </span>
            )}
          </div>
          <TutorWsResults rows={rows} price={price} />
        </div>
        <div className="lg:sticky lg:top-4">
          <TutorWsCart price={price} balance={balance} />
        </div>
      </div>
    </div>
  );
}
