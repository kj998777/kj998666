"use client";

// 2026-10-03 원장님: "학생별로 제출한 시험을 볼 수 있게 하는 탭". 한 학생이 낸 시험을 최신순으로 늘어놓고,
// 시험을 펼치면 문항별 낸 답·정답·맞음/틀림·찍음과 풀이를, 버튼으로 그 시험의 개별 성적 보고서 PDF를 받는다.
// 원장님 학생 화면(/students/[key]?tab=subs)과 과외선생님 "내 학생"(/tutor/students/[name])이 같이 쓴다.
// 데이터는 lib/students/submitted.ts(buildSubmittedExams)가 서버에서 만들어 넘긴다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import type { SubmittedExam } from "@/lib/students/submitted";
import type { ReportData } from "@/app/(staff)/exams/[code]/results/buildReportPdf";

const DIFF_CLS: Record<string, string> = {
  하: "bg-white text-slate-600 ring-1 ring-slate-300",
  중하: "bg-slate-200 text-slate-800",
  중: "bg-slate-600 text-white",
  중상: "bg-brand-600 text-white",
  상: "bg-brand-800 text-white",
};

function pct(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function day(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export type ExamLinks = Record<string, { href: string | null; reportUrl: string | null }>;
/** 제출 하나 지우기(서버 액션) — 없으면 삭제 버튼을 감춘다 */
export type DeleteSubmission = (submissionId: string) => Promise<{ ok: boolean; msg?: string }>;

export default function SubmittedExams({
  exams,
  links,
  emptyText = "아직 제출한 시험이 없습니다.",
  deleteSubmission,
  pickBase,
  picked,
}: {
  exams: SubmittedExam[];
  deleteSubmission?: DeleteSubmission;
  /** 2026-10-05 오답 유사문제 고르기 화면 주소 앞부분(뒤에 제출 id를 붙임) — 없으면 버튼을 감춘다 */
  pickBase?: string;
  /** 제출 id → 선생님이 고른 유사문제 수(null = 아직 안 고름) */
  picked?: Record<string, number | null>;
  /** 시험 코드 → 결과 화면 주소·보고서 데이터 주소(없으면 버튼을 감춘다) */
  links: ExamLinks;
  emptyText?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(exams[0] ? [exams[0].submissionId] : []));
  if (!exams.length) return <div className="card text-sm text-slate-500">{emptyText}</div>;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="space-y-3">
      {exams.map((e) => (
        <ExamCard
          key={e.submissionId}
          e={e}
          link={links[e.code]}
          open={open.has(e.submissionId)}
          onToggle={() => toggle(e.submissionId)}
          onDelete={deleteSubmission}
          pickHref={pickBase ? pickBase + e.submissionId : null}
          pickedN={picked ? picked[e.submissionId] ?? null : undefined}
        />
      ))}
    </div>
  );
}

function ExamCard({
  e,
  link,
  open,
  onToggle,
  onDelete,
  pickHref,
  pickedN,
}: {
  e: SubmittedExam;
  link?: ExamLinks[string];
  open: boolean;
  onToggle: () => void;
  onDelete?: DeleteSubmission;
  pickHref?: string | null;
  pickedN?: number | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [deleting, startDelete] = useTransition();
  function doDelete() {
    if (!onDelete) return;
    startDelete(async () => {
      const r = await onDelete(e.submissionId);
      if (!r.ok) {
        setMsg("실패: " + (r.msg || "삭제하지 못했습니다."));
        setAsking(false);
        return;
      }
      router.refresh();
    });
  }
  const [onlyMiss, setOnlyMiss] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const katex = useKatex();
  const m = (t: string) => ({ __html: renderMathHtml(katex, t) });
  const rows = onlyMiss ? e.rows.filter((r) => !r.ok) : e.rows;

  async function onReport() {
    if (!link?.reportUrl) return;
    setBusy(true);
    setMsg("보고서 자료를 불러오는 중…");
    try {
      const res = await fetch(link.reportUrl, { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.msg || "자료를 불러오지 못했습니다.");
      const d = body as ReportData;
      const st = d.students.find((s) => s.id === e.submissionId);
      if (!st) throw new Error("이 제출을 보고서 자료에서 찾지 못했습니다.");
      const { ensureReportTools, buildIndividualHtml, htmlToPdfBytes, downloadBytes } = await import("@/app/(staff)/exams/[code]/results/buildReportPdf");
      const { katex: k } = await ensureReportTools((t) => setMsg(t));
      setMsg("보고서를 그리는 중…");
      const bytes = await htmlToPdfBytes(buildIndividualHtml(k, d, st, { promo: true }));
      downloadBytes(bytes, `${e.name}_${st.class_label}_${st.student_name}.pdf`);
      setMsg("");
    } catch (err: any) {
      setMsg("실패: " + (err?.message || String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={onToggle} className="text-left min-w-[14rem] flex-1">
          <div className="font-medium break-words">
            <span className="text-slate-400 mr-1">{open ? "▾" : "▸"}</span>
            {e.name}
            {e.attempt != null && <span className="ml-2 badge bg-slate-100 text-slate-600 align-middle">{e.attempt}번째 제출</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {day(e.submittedAt)} · {e.classLabel}
          </div>
        </button>
        <div className="ml-auto text-right">
          <div className="text-lg font-semibold tabular-nums whitespace-nowrap">
            {e.score} <span className="text-sm font-normal text-slate-500">/ {e.max}점</span>
            <span className="ml-2 text-sm text-slate-600">{pct(e.rate)}</span>
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            정답 {e.correct} · 오답 {e.wrong} · 무응답 {e.blank}
            {e.guessed > 0 && (
              <span className="text-amber-700">
                {" "}
                · 찍음 {e.guessed}개 중 {e.guessedCorrect}개 맞음(실질 {e.realScore}점)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn-secondary" onClick={onToggle}>
          {open ? "답안 접기" : "답안 보기"}
        </button>
        {link?.reportUrl && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={onReport}>
            {busy ? "만드는 중…" : "개별 보고서 PDF"}
          </button>
        )}
        {pickHref && e.wrong + e.blank + e.guessedCorrect > 0 && (
          <Link href={pickHref} className="btn-secondary">
            유사문제 고르기
            <span className={"ml-1.5 text-xs " + (pickedN == null ? "text-amber-700" : "text-slate-500")}>
              {pickedN == null ? "아직 안 고름" : `${pickedN}문제`}
            </span>
          </Link>
        )}
        {link?.href && (
          <Link href={link.href} className="link-accent">
            이 시험 전체 결과
          </Link>
        )}
        {onDelete && !asking && (
          <button type="button" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => setAsking(true)}>
            이 제출 삭제
          </button>
        )}
        {msg && <span className={msg.startsWith("실패") ? "text-red-600" : "text-slate-500"}>{msg}</span>}
      </div>
      {onDelete && asking && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
          <span className="text-red-800">
            이 시험 제출과 채점 결과를 지웁니다. 반 평균·보고서에서도 빠지고 되돌릴 수 없습니다. 학생은 이 시험을 다시 낼 수 있습니다.
          </span>
          <button type="button" className="btn-danger" disabled={deleting} onClick={doDelete}>
            {deleting ? "지우는 중…" : "삭제"}
          </button>
          <button type="button" className="btn-secondary" disabled={deleting} onClick={() => setAsking(false)}>
            취소
          </button>
        </div>
      )}

      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={onlyMiss} onChange={(ev) => setOnlyMiss(ev.target.checked)} />
              틀린·무응답 문항만
            </label>
            {e.showKey ? (
              <span className="text-xs text-slate-500">문항을 누르면 문제·풀이가 펼쳐집니다.</span>
            ) : (
              <span className="text-xs text-amber-700">구매하지 않은(또는 구매가 취소된) 시험이라 정답·풀이는 보이지 않습니다.</span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">틀린 문항이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-2 w-12">번호</th>
                    <th className="py-2 pr-2">단원</th>
                    <th className="py-2 pr-2 w-14">난이도</th>
                    <th className="py-2 pr-2">낸 답</th>
                    {e.showKey && <th className="py-2 pr-2">정답</th>}
                    <th className="py-2 pr-2 w-16 text-center">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = shown.has(r.label);
                    const canOpen = e.showKey && !!(r.problem || r.solution);
                    return (
                      <Fragment key={r.label}>
                        <tr
                          className={
                            "border-b border-slate-100 " +
                            (r.ok ? "" : r.blank ? "bg-amber-50" : "bg-brand-50") +
                            (canOpen ? " cursor-pointer hover:bg-slate-50" : "")
                          }
                          onClick={() =>
                            canOpen &&
                            setShown((prev) => {
                              const n = new Set(prev);
                              if (n.has(r.label)) n.delete(r.label);
                              else n.add(r.label);
                              return n;
                            })
                          }
                        >
                          <td className="py-2 pr-2 font-medium tabular-nums">
                            {canOpen && <span className="text-slate-400 mr-0.5">{isOpen ? "▾" : "▸"}</span>}
                            {r.label}
                          </td>
                          <td className="py-2 pr-2 text-slate-600">{r.unit || "-"}</td>
                          <td className="py-2 pr-2">
                            {r.difficulty && (
                              <span className={"rounded px-1.5 text-[11px] font-bold whitespace-nowrap " + (DIFF_CLS[r.difficulty] ?? DIFF_CLS["중"])}>
                                {r.difficulty}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2 break-words">
                            {r.blank ? <span className="text-amber-700">무응답</span> : r.type === "주관식" ? <span dangerouslySetInnerHTML={m(r.given)} /> : r.given}
                            {r.guessed && <span className="ml-1 badge bg-amber-100 text-amber-800">찍음</span>}
                          </td>
                          {e.showKey && (
                            <td className="py-2 pr-2 break-words">
                              {r.answerDisplay ? <span dangerouslySetInnerHTML={m(r.answerDisplay)} /> : r.key ?? "-"}
                            </td>
                          )}
                          <td className={"py-2 pr-2 text-center font-semibold " + (r.ok ? "text-slate-800" : r.blank ? "text-amber-700" : "text-brand-700")}>
                            {r.ok ? "○" : r.blank ? "–" : "×"}
                            <div className="text-[11px] font-normal text-slate-500 tabular-nums">
                              {r.earned}/{r.points}점
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-slate-100 bg-white">
                            <td colSpan={e.showKey ? 6 : 5} className="py-3 px-2 space-y-2">
                              {r.problem ? (
                                <div className="leading-7 break-words" dangerouslySetInnerHTML={m(r.problem)} />
                              ) : (
                                <p className="text-slate-400">문제 글이 없습니다(시험지에서 확인해 주세요).</p>
                              )}
                              {r.solution && (
                                <div className="rounded bg-slate-50 px-3 py-2 leading-7 break-words">
                                  <span className="text-xs text-slate-500">풀이</span>
                                  <div dangerouslySetInnerHTML={m(r.solution)} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
