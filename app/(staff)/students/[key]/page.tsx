import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { classDisplay, loadStudentDetail, loadStudentIndex } from "@/lib/students/load";
import { decodeKey, encodeKey, keyName, mergeCandidates, trendSvg, type Bucket } from "@/lib/students/analysis";
import StudentTools from "./StudentTools";
import ReviewCards from "./ReviewCards";
import SubmittedExams, { type ExamLinks } from "@/app/_components/SubmittedExams";

export const dynamic = "force-dynamic";

function pct(r: number | null | undefined): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR");
}
function barColor(r: number): string {
  return r >= 0.8 ? "bg-emerald-500" : r >= 0.6 ? "bg-amber-500" : "bg-red-500";
}

function Bars({ rows }: { rows: Bucket[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.name}>
            {r.name}
          </span>
          <span className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <span className={"block h-full " + barColor(r.rate)} style={{ width: `${Math.round(r.rate * 100)}%` }} />
          </span>
          <span className="tabular-nums text-slate-600 w-24 text-right">
            {r.ok}/{r.n} · {pct(r.rate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function StudentPage({ params, searchParams }: { params: { key: string }; searchParams?: { tab?: string } }) {
  const session = await requireRole("viewer");
  const key = decodeKey(params.key);
  if (!key) notFound();
  const supabase = await createClient();
  const idx = await loadStudentIndex(supabase);
  const detail = await loadStudentDetail(supabase, idx, key);
  if (!detail) {
    // 다른 학생에 합쳐진 키로 들어오면 대표 학생으로 안내
    const into = idx.keyRows.find((r) => r.key === key)?.merged_into;
    return (
      <div className="card space-y-2 max-w-lg">
        <p className="text-sm text-slate-600">
          {into ? "이 학생은 다른 학생 기록에 합쳐졌습니다." : `${keyName(key)} 학생의 제출을 찾지 못했습니다.`}
        </p>
        {into ? (
          <Link href={`/students/${encodeKey(into)}`} className="btn-primary inline-block">
            합쳐진 학생 보기
          </Link>
        ) : (
          <Link href="/students" className="link-accent text-sm">
            학생 목록으로
          </Link>
        )}
      </div>
    );
  }
  const { entry, analysis: a, memo } = detail;
  const classText = classDisplay(entry, idx.tutorLabel);
  const canEdit = session.role === "admin" || session.role === "editor";
  const candidates = mergeCandidates(entry, idx.entries).map((c) => ({
    key: c.key,
    classText: classDisplay(c, idx.tutorLabel),
    nExams: c.nExams,
    lastAt: c.lastAt,
  }));
  const members = entry.members
    .filter((m) => m !== entry.key)
    .map((m) => ({ key: m, label: m.startsWith("과외:") ? `과외 · ${keyName(m)}` : m.slice(2).replace("|", " ") }));
  const t = a.trend;
  const trendText =
    t.direction === "up" ? "오르는 중" : t.direction === "down" ? "내려가는 중" : t.direction === "flat" ? "비슷함" : "시험 2회부터";
  const trendCls = t.direction === "up" ? "text-emerald-700" : t.direction === "down" ? "text-red-600" : "text-slate-700";
  const nameOf = new Map(a.exams.map((e) => [e.examId, e.name]));
  const tab = searchParams?.tab === "subs" ? "subs" : "analysis";
  const links: ExamLinks = {};
  for (const e of detail.submitted)
    links[e.code] = {
      href: `/exams/${encodeURIComponent(e.code)}/results`,
      reportUrl: `/exams/${encodeURIComponent(e.code)}/results/report-data`,
    };
  const bigChanges = a.areaChanges.filter((c) => Math.abs(c.delta) >= 0.2).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href="/students" className="text-sm link-accent">
            ← 학생 목록
          </Link>
          <h1 className="text-xl font-semibold mt-1">
            {entry.name}
            {entry.hidden && <span className="ml-2 badge bg-slate-100 text-slate-500 align-middle">숨김</span>}
          </h1>
          <p className="text-sm text-slate-500">
            {classText} · 시험 {a.exams.length}회{a.exams.length ? ` · ${day(a.exams[0].submittedAt)} ~ ${day(a.exams[a.exams.length - 1].submittedAt)}` : ""}
          </p>
        </div>
      </div>

      {/* 2026-10-03: "분석" / "제출한 시험"(시험마다 문항별 답안·풀이·개별 보고서) 탭 */}
      <div className="flex gap-1 border-b border-slate-200 text-sm">
        <Link
          href={`/students/${params.key}`}
          className={"px-3 py-2 -mb-px border-b-2 " + (tab === "subs" ? "border-transparent text-slate-500 hover:text-slate-800" : "border-brand-700 font-medium text-slate-900")}
        >
          분석
        </Link>
        <Link
          href={`/students/${params.key}?tab=subs`}
          className={"px-3 py-2 -mb-px border-b-2 " + (tab === "subs" ? "border-brand-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}
        >
          제출한 시험 <span className="tabular-nums">{detail.submitted.length}</span>
        </Link>
      </div>

      {tab === "subs" ? (
        <SubmittedExams exams={detail.submitted} links={links} />
      ) : (
      <>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="card text-center">
          <div className="text-2xl font-semibold tabular-nums">{pct(a.avgRate)}</div>
          <div className="text-xs text-slate-500 mt-1">평균 득점률</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-semibold tabular-nums">{pct(a.lastRate)}</div>
          <div className="text-xs text-slate-500 mt-1">최근 시험</div>
        </div>
        <div className="card text-center">
          <div className={"text-2xl font-semibold " + trendCls}>{trendText}</div>
          <div className="text-xs text-slate-500 mt-1">
            추이{t.slopePerExam != null ? ` · 시험마다 ${t.slopePerExam >= 0 ? "+" : ""}${Math.round(t.slopePerExam * 100)}%p` : ""}
          </div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-semibold tabular-nums">
            {a.okItems}/{a.totalItems}
          </div>
          <div className="text-xs text-slate-500 mt-1">맞힌 문항 · 무응답 {pct(a.blankRate)}</div>
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">종합 의견</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          {a.advice.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <p className="text-xs text-slate-400">채점 결과에서 규칙으로 뽑은 문장입니다. 상담 메모(아래)에 덧붙일 말을 적으면 보고서에 함께 들어갑니다.</p>
      </div>

      <StudentTools
        studentKey={entry.key}
        name={entry.name}
        classText={classText}
        analysis={a}
        memo={memo}
        hidden={entry.hidden}
        canEdit={canEdit && idx.keysAvailable}
        candidates={candidates.map((c) => ({ ...c, id: encodeKey(c.key) }))}
        members={members}
        canBank={canEdit}
      />

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">시험별 점수 추이</h2>
          <span className="text-xs text-slate-500">
            <span className="inline-block w-4 border-t-2 border-blue-600 align-middle mr-1" />
            득점률
            <span className="inline-block w-4 border-t-2 border-dashed border-slate-400 align-middle ml-3 mr-1" />
            같은 반 평균(2명 이상일 때)
          </span>
        </div>
        {a.exams.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[520px]" dangerouslySetInnerHTML={{ __html: trendSvg(a.exams).replace(/ width="680" height="230"/, ' width="100%"') }} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">채점된 시험이 없습니다.</p>
        )}
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">시험</th>
                <th className="py-2 pr-2">날짜</th>
                <th className="py-2 pr-2">반</th>
                <th className="py-2 pr-2 text-right">점수</th>
                <th className="py-2 pr-2 text-right">득점률</th>
                <th className="py-2 pr-2 text-right">정답·오답·무응답</th>
                <th className="py-2 pr-2 text-right">반 평균</th>
                <th className="py-2 pr-2 text-right">전체 평균</th>
              </tr>
            </thead>
            <tbody>
              {[...a.exams].reverse().map((e) => (
                <tr key={e.examId} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <Link href={`/exams/${encodeURIComponent(e.code)}/results`} className="hover:underline">
                      {e.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">{day(e.submittedAt)}</td>
                  <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">{e.classLabel}</td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {Math.round(e.score * 100) / 100} / {Math.round(e.max * 100) / 100}
                    {e.guessed > 0 && (
                      <div className="text-xs text-amber-700" title="찍어서 맞힌 문항의 점수를 뺀 점수">
                        실질 {Math.round(e.realScore * 100) / 100} (찍음 {e.guessed}개 중 {e.guessedCorrect}개 맞음)
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-medium">{pct(e.rate)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {e.correct} · {e.wrong} · {e.blank}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{e.classAvg != null ? `${pct(e.classAvg)} (${e.classCount}명)` : "-"}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{e.examAvg != null ? `${pct(e.examAvg)} (${e.examCount}명)` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2026-10-01 찍음 추이: 시험마다 "찍음"으로 표시한 문항 수와 그중 맞힌 수(찍음을 쓰기 시작한 뒤의 시험만) */}
      {a.exams.some((e) => e.guessed > 0) && (
        <div className="card space-y-2">
          <h2 className="font-medium">찍음 추이</h2>
          <p className="text-xs text-slate-500">
            시험마다 확실하지 않아 &ldquo;찍음&rdquo;으로 표시한 문항 수입니다. 줄어들수록 스스로 확신하고 푸는 문항이 늘어난 것이에요.
          </p>
          <ul className="space-y-1.5 text-sm">
            {a.exams.map((e) => {
              const max = Math.max(1, ...a.exams.map((x) => x.guessed));
              return (
                <li key={e.examId} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-slate-600" title={e.name}>
                    {day(e.submittedAt)} {e.name}
                  </span>
                  <span className="h-2.5 flex-1 rounded bg-slate-100">
                    <span className="block h-2.5 rounded bg-amber-400" style={{ width: `${(e.guessed / max) * 100}%` }} />
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-xs text-slate-600">
                    찍음 {e.guessed}개 · 맞음 {e.guessedCorrect}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-medium">영역별 정답률</h2>
          {a.areas.length ? <Bars rows={a.areas} /> : <p className="text-sm text-slate-500">영역 정보가 있는 문항이 없습니다.</p>}
          {bigChanges.length > 0 && (
            <div className="border-t border-slate-100 pt-2 text-sm">
              <p className="text-xs text-slate-500 mb-1">앞 시험들과 비교(시험을 시간순 절반으로 나눔)</p>
              <ul className="space-y-0.5">
                {bigChanges.map((c) => (
                  <li key={c.name}>
                    <b>{c.name}</b> {pct(c.before)} → {pct(c.after)}{" "}
                    <span className={c.delta > 0 ? "text-emerald-700" : "text-red-600"}>{c.delta > 0 ? "좋아짐" : "떨어짐"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="card space-y-3">
          <h2 className="font-medium">난이도·유형별</h2>
          <Bars rows={a.diffs} />
          {a.types.length > 1 && (
            <div className="border-t border-slate-100 pt-2">
              <Bars rows={a.types} />
            </div>
          )}
          <p className="text-xs text-slate-400">난이도는 AI가 문제를 풀어 보고 붙인 값입니다.</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-medium">우선 복습할 단원</h2>
        {a.weakUnits.length ? (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">단원</th>
                  <th className="py-2 pr-2 text-right">맞힌 / 출제</th>
                  <th className="py-2 pr-2">나온 문항</th>
                </tr>
              </thead>
              <tbody>
                {a.weakUnits.map((u) => (
                  <tr key={u.name} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2 font-medium">
                      {u.name}
                      {canEdit && (
                        <Link href={`/bank?unit=${encodeURIComponent(u.name)}`} className="block text-xs font-normal link-accent">
                          비슷한 문제 찾기 →
                        </Link>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                      {u.ok} / {u.n}
                    </td>
                    <td className="py-2 pr-2 text-slate-600">
                      {u.refs.map((r, i) => (
                        <span key={i} className={"mr-2 whitespace-nowrap " + (r.ok ? "text-slate-400" : "text-red-600")}>
                          {nameOf.get(r.examId)} {r.label}번 {r.ok ? "○" : "×"}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">두 번 이상 나온 단원 중 눈에 띄게 약한 단원은 없습니다.</p>
        )}
        {a.units.length > a.weakUnits.length && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500">모든 단원 보기 ({a.units.length}개)</summary>
            <div className="mt-2">
              <Bars rows={a.units} />
            </div>
          </details>
        )}
      </div>

      <ReviewCards review={a.review} />
      </>
      )}
    </div>
  );
}
