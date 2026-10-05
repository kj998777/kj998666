"use client";

// 오답 유사문제 고르기(2026-10-05 원장님 "학생이 아니라 선생님이 선택할 수 있게"). 학생이 틀린(무응답·찍어서 맞힌)
// 문항마다 같은 논리 유형의 다른 학교 문제 후보를 늘어놓고, 선생님이 체크해서 저장하면 학생 화면(/r/[제출 id])에는
// 고른 문제만 나온다. 처음 열면 예전 자동 추천(쉬운 것 1 → 같은 것 2 → 어려운 것 1)이 체크돼 있다.
// 직원 화면(/students/similar/[sid])과 과외선생님 화면(/tutor/students/similar/[sid])이 같이 쓴다.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import ProblemPageImage from "@/app/(tutor)/tutor/review/[itemId]/ProblemPageImage";
import type { PickCandidate, PickGroup, PickPage } from "@/lib/similar/load";
import { saveSimilarPicks } from "@/lib/similar/actions";

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };
const DIFF_CLS: Record<string, string> = {
  하: "bg-white text-slate-600 ring-1 ring-slate-300",
  중하: "bg-slate-200 text-slate-800",
  중: "bg-slate-600 text-white",
  중상: "bg-brand-600 text-white",
  상: "bg-brand-800 text-white",
};
const TIER_TXT: Record<PickCandidate["tier"], string> = { easier: "쉬움", same: "같음", harder: "어려움" };
const KIND_TXT: Record<PickGroup["kind"], string> = { wrong: "틀림", blank: "무응답", guessed: "찍어서 맞힘" };

function Diff({ d }: { d: string }) {
  if (!d) return null;
  return <span className={"rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap " + (DIFF_CLS[d] ?? DIFF_CLS["중"])}>{d}</span>;
}
const num = (l: string) => (/^\d/.test(l) ? `${l}번` : l);

export default function SimilarPicker({ page, backHref, backText }: { page: PickPage; backHref: string; backText: string }) {
  const initial = useMemo(() => Object.fromEntries(page.groups.map((g) => [g.label, g.picked])), [page]);
  const recommended = useMemo(
    () => Object.fromEntries(page.groups.map((g) => [g.label, g.candidates.filter((c) => c.recommended).map((c) => c.id)])),
    [page]
  );
  const [picks, setPicks] = useState<Record<string, string[]>>(initial);
  const [saved, setSaved] = useState(page.saved);
  const [dirty, setDirty] = useState(!page.saved);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const total = Object.values(picks).reduce<number>((a, b) => a + (b as string[]).length, 0);
  const withCands = page.groups.filter((g) => g.candidates.length).length;

  function toggle(label: string, id: string) {
    setPicks((prev) => {
      const cur = prev[label] ?? [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 12 ? cur : [...cur, id];
      return { ...prev, [label]: next };
    });
    setDirty(true);
    setMsg("");
  }
  function setGroup(label: string, ids: string[]) {
    setPicks((prev) => ({ ...prev, [label]: ids }));
    setDirty(true);
    setMsg("");
  }
  function save() {
    start(async () => {
      const r = await saveSimilarPicks(page.submissionId, picks);
      if (!r.ok) {
        setMsg("실패: " + r.msg);
        return;
      }
      setSaved(true);
      setDirty(false);
      setMsg(`저장했습니다. 학생 화면에 ${r.n}문제가 나옵니다.`);
    });
  }
  const studentUrl = typeof window === "undefined" ? `/r/${page.submissionId}` : `${window.location.origin}/r/${page.submissionId}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(studentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <div>
        <Link href={backHref} className="text-sm link-accent">
          ← {backText}
        </Link>
        <h1 className="text-xl font-semibold mt-1">오답 유사문제 고르기</h1>
        <p className="text-sm text-slate-600 break-words">
          {page.studentName} · {page.classLabel} · {page.examName}
        </p>
      </div>

      <div className="card space-y-2 text-sm">
        <p className="text-slate-700">
          다시 볼 문항 <b>{page.groups.length}</b>개
          {withCands < page.groups.length ? ` (그중 ${withCands}개에 후보가 있어요)` : ""}. 문항마다 <b>같은 논리로 푸는 다른 학교 문제</b>를
          골라 저장하면, 학생 화면에는 <b>선생님이 고른 문제만</b> 나옵니다.
          {!page.saved && " 처음에는 추천(쉬운 것 1 → 같은 난이도 2 → 어려운 것 1)이 체크돼 있어요."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">학생 링크</span>
          <code className="rounded bg-slate-100 px-2 py-0.5 text-xs break-all select-all">{studentUrl}</code>
          <button type="button" className="btn-secondary py-1 px-3 text-xs" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          개별 성적 보고서 PDF에도 이 링크의 QR이 들어갑니다(고른 문제가 있을 때만). {saved ? "" : "아직 저장 전이라 학생 화면에는 아무 문제도 나오지 않습니다."}
        </p>
      </div>

      {page.groups.length === 0 && <div className="card text-sm text-slate-500">틀린 문항이 없습니다.</div>}

      {page.groups.map((g) => (
        <GroupBox
          key={g.label}
          sid={page.submissionId}
          g={g}
          picked={picks[g.label] ?? []}
          onToggle={(id) => toggle(g.label, id)}
          onSet={(ids) => setGroup(g.label, ids)}
          rec={recommended[g.label] ?? []}
        />
      ))}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-sm text-slate-700">
            고른 문제 <b className="tabular-nums">{total}</b>개
          </span>
          {msg && <span className={"text-sm " + (msg.startsWith("실패") ? "text-red-600" : "text-emerald-700")}>{msg}</span>}
          {!msg && dirty && saved && <span className="text-xs text-amber-700">바꾼 내용이 아직 저장되지 않았어요</span>}
          <button type="button" className="btn-primary ml-auto" disabled={pending || (!dirty && saved)} onClick={save}>
            {pending ? "저장하는 중…" : saved && !dirty ? "저장됨" : "저장하고 학생에게 보이기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupBox({
  sid,
  g,
  picked,
  onToggle,
  onSet,
  rec,
}: {
  sid: string;
  g: PickGroup;
  picked: string[];
  onToggle: (id: string) => void;
  onSet: (ids: string[]) => void;
  rec: string[];
}) {
  const [showOrig, setShowOrig] = useState(false);
  const [more, setMore] = useState(false);
  const given = g.kind === "blank" ? "무응답" : CIRC[g.given] ?? g.given;
  const shown = more ? g.candidates : g.candidates.filter((c, i) => i < 8 || picked.includes(c.id));
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{num(g.label)}</h2>
        <Diff d={g.difficulty} />
        <span className={"text-xs font-medium " + (g.kind === "guessed" ? "text-amber-700" : "text-brand-700")}>
          {KIND_TXT[g.kind]}
          {g.kind !== "blank" && ` · 학생 답 ${given}`}
        </span>
        <span className="ml-auto text-xs text-slate-500 tabular-nums">
          고름 {picked.length} / 후보 {g.candidates.length}
        </span>
      </div>
      {g.logicName ? (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium text-slate-900">{g.logicName}</span>
          {g.logic && <p className="mt-0.5 text-slate-600 leading-relaxed">{g.logic}</p>}
        </div>
      ) : (
        <p className="text-xs text-slate-500">{g.unit || "논리 유형이 정해지지 않은 문항"}</p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {g.original && (
          <button type="button" className="text-slate-500 underline underline-offset-2" onClick={() => setShowOrig((v) => !v)}>
            {showOrig ? "원래 문제 접기" : "학생이 틀린 원래 문제 보기"}
          </button>
        )}
        {g.candidates.length > 0 && (
          <>
            <button type="button" className="text-slate-500 underline underline-offset-2" onClick={() => onSet(rec)}>
              추천대로
            </button>
            <button type="button" className="text-slate-500 underline underline-offset-2" onClick={() => onSet([])}>
              모두 빼기
            </button>
          </>
        )}
      </div>
      {showOrig && g.original && (
        <ProblemPageImage pdfUrl={`/api/similar/${sid}/pick-pdf/${g.original.id}`} page={g.original.sourcePage} bbox={g.original.bbox} label={g.label} paged />
      )}

      {g.candidates.length === 0 ? (
        <p className="text-sm text-slate-500">아직 이 문항과 같은 유형의 다른 학교 문제(정답 확정·쪽 정보 있음)가 없어요.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {shown.map((c) => (
            <CandRow key={c.id} sid={sid} c={c} on={picked.includes(c.id)} onToggle={() => onToggle(c.id)} />
          ))}
        </ul>
      )}
      {g.candidates.length > shown.length && (
        <button type="button" className="text-xs link-accent" onClick={() => setMore(true)}>
          후보 {g.candidates.length - shown.length}개 더 보기
        </button>
      )}
    </section>
  );
}

function CandRow({ sid, c, on, onToggle }: { sid: string; c: PickCandidate; on: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={on ? "bg-brand-50/40" : ""}>
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={onToggle} aria-label={`${c.examName} ${num(c.label)} 고르기`} />
        <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="font-medium text-slate-900 break-words">{c.examName}</span>
          <span className="text-slate-500"> · {num(c.label)}</span>
        </button>
        {c.recommended && <span className="badge bg-emerald-50 text-emerald-700">추천</span>}
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{TIER_TXT[c.tier]}</span>
        <Diff d={c.difficulty} />
        <button type="button" className="text-xs text-slate-500 underline underline-offset-2 whitespace-nowrap" onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "문제 보기"}
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <ProblemPageImage pdfUrl={`/api/similar/${sid}/pick-pdf/${c.id}`} page={c.sourcePage} bbox={c.bbox} label={c.label} paged />
        </div>
      )}
    </li>
  );
}
