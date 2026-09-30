import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { loadBankItems } from "@/lib/bank/load";
import { DIFFS, facets, parseFilter, search } from "@/lib/bank/search";
import BankResults, { type ResultRow } from "./BankResults";
import CartPanel from "./CartPanel";

export const dynamic = "force-dynamic";

const PAGE = 40;

// 문항 은행(2026-09-30): 모든 시험의 문항을 단원·난이도·학교·글자로 찾아 담고, 담은 문항으로 새 시험지 + 정답·해설지 PDF를 만든다.
export default async function BankPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireRole("editor");
  const f = parseFilter(searchParams);
  const page = Math.max(1, Number(Array.isArray(searchParams.p) ? searchParams.p[0] : searchParams.p) || 1);
  const supabase = await createClient();
  const all = await loadBankItems(supabase);
  const found = search(all, f);
  const fc = facets(all, f);
  const rows: ResultRow[] = found.slice((page - 1) * PAGE, page * PAGE).map((it) => ({
    id: it.id,
    examCode: it.examCode,
    examName: it.examName,
    label: it.label,
    area: it.area,
    unit: it.unit,
    difficulty: it.difficulty,
    type: it.type,
    statement: it.statement.slice(0, 700),
    answer: it.answerDisplay || it.correctAnswers,
    confirmed: it.confirmed,
    hasLocation: it.hasLocation,
  }));
  const pages = Math.max(1, Math.ceil(found.length / PAGE));
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
    return s ? `/bank?${s}` : "/bank";
  };
  const confirmedN = all.filter((x) => x.confirmed).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">문항 은행</h1>
        <p className="text-sm text-slate-500">
          시험 {new Set(all.map((x) => x.examId)).size}개의 문항 {all.length}개(정답 확정 {confirmedN}개)에서 찾아 담은 뒤, 새 시험지와 정답·해설지 PDF를
          만듭니다. 문제는 원래 시험지에서 그 문항 자리를 오려 붙이므로 그림·표·보기가 그대로 나옵니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] items-start">
        <div className="space-y-4 min-w-0">
          <form method="get" action="/bank" className="card space-y-3">
            <div className="flex flex-wrap gap-2">
              <input name="q" defaultValue={f.q ?? ""} className="input flex-1 min-w-[12rem]" placeholder="문제 글·단원·시험 이름으로 찾기 (예: 근과 계수)" />
              <button className="btn-primary" type="submit">
                찾기
              </button>
            </div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
              <select name="level" defaultValue={f.level ?? ""} className="input" aria-label="학교급">
                <option value="">모든 학교급</option>
                <option value="고">고등</option>
                <option value="중">중등</option>
                <option value="초">초등</option>
              </select>
              <select name="grade" defaultValue={f.grade ?? ""} className="input" aria-label="학년">
                <option value="">모든 학년</option>
                {[1, 2, 3, 4, 5, 6].map((g) => (
                  <option key={g} value={String(g)}>
                    {g}학년
                  </option>
                ))}
              </select>
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
              <select name="area" defaultValue={f.area ?? ""} className="input col-span-2" aria-label="영역">
                <option value="">모든 영역</option>
                {fc.areas.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.n})
                  </option>
                ))}
              </select>
              <input name="unit" defaultValue={f.unit ?? ""} list="bank-units" className="input col-span-2" placeholder="단원(일부만 적어도 됨)" />
              <datalist id="bank-units">
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
              <label className="flex items-center gap-1">
                <input type="checkbox" name="all" value="1" defaultChecked={!!f.all} />
                정답 확정 전 문항도
              </label>
              <Link href="/bank" className="text-slate-500 hover:underline">
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
          <BankResults rows={rows} allIds={found.slice(0, 60).map((x) => x.id)} />
        </div>
        <div className="lg:sticky lg:top-4">
          <CartPanel />
        </div>
      </div>
    </div>
  );
}
