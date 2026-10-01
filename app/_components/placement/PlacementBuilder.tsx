"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPlacement, previewPlacement, replacePlacementItem } from "@/lib/placement/actions";
import { PLACEMENT_DEFAULT_N, scopeLabel, type Scope, type ScopeOption } from "@/lib/placement/pick";
import type { PreviewItem } from "@/lib/placement/server";
import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";

// 입학테스트 만들기(0047): 학년·과목을 고르면 쉬운 문항부터 어려운 문항까지 고르게 뽑아 보여 주고,
// 마음에 안 드는 문항은 하나씩 바꾸거나 통째로 다시 뽑은 뒤 만든다. 학원·과외선생님 화면이 같이 쓴다.
const DIFF_CLS: Record<string, string> = {
  하: "bg-green-100 text-green-800",
  중하: "bg-lime-100 text-lime-800",
  중: "bg-yellow-100 text-yellow-800",
  중상: "bg-orange-100 text-orange-800",
  상: "bg-red-100 text-red-800",
};

export default function PlacementBuilder({
  options,
  kind,
  cost,
  balance,
  detailBase,
}: {
  options: ScopeOption[];
  kind: "staff" | "tutor";
  cost: number;
  balance?: number;
  detailBase: string;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<string>(options[0] ? `${options[0].level}${options[0].grade}` : "");
  const opt = useMemo(() => options.find((o) => `${o.level}${o.grade}` === pick) ?? null, [options, pick]);
  const [subject, setSubject] = useState("");
  const [n, setN] = useState(PLACEMENT_DEFAULT_N);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const katex = useKatex();

  const scope: Scope | null = opt ? { level: opt.level, grade: opt.grade, subject } : null;
  const label = scope ? scopeLabel(scope) : "";

  const FAIL = "잠시 연결이 고르지 않았습니다. 한 번 더 눌러 주세요.";

  function draw() {
    if (!scope) return;
    // 처음 뽑기는 지금 seed, 다시 뽑기는 새 seed(같은 조건이어도 다른 조합)
    const nextSeed = items ? Math.floor(Math.random() * 1e9) : seed;
    setSeed(nextSeed);
    setMsg("");
    setConfirming(false);
    start(async () => {
      const r = await previewPlacement(scope, n, nextSeed).catch(() => ({ ok: false, msg: FAIL }) as Awaited<ReturnType<typeof previewPlacement>>);
      if (!r.ok || !r.items) {
        setItems(null);
        setMsg(r.msg || "뽑지 못했습니다.");
        return;
      }
      setItems(r.items);
      setRejected([]);
      if (!title) setTitle(`입학테스트 · ${label}`);
      if (r.items.length < n) setMsg(`고를 수 있는 문항이 모자라 ${r.items.length}문항만 뽑았습니다.`);
    });
  }

  function swap(i: number) {
    if (!scope || !items) return;
    const s = seed + i * 7919 + rejected.length * 104729;
    const ex = [...rejected, items[i].id];
    start(async () => {
      const r = await replacePlacementItem(scope, items.map((x) => x.id), i, s, ex).catch(
        () => ({ ok: false, msg: FAIL }) as Awaited<ReturnType<typeof replacePlacementItem>>
      );
      if (!r.ok || !r.item) {
        setMsg(r.msg || "바꾸지 못했습니다.");
        return;
      }
      setRejected(ex);
      setItems(items.map((x, j) => (j === i ? r.item! : x)));
      setMsg("");
    });
  }

  function make() {
    if (!items) return;
    if (kind === "tutor" && cost > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    start(async () => {
      const r = await createPlacement(items.map((x) => x.id), title.trim() || `입학테스트 · ${label}`, label).catch(
        () => ({ ok: false, msg: FAIL }) as Awaited<ReturnType<typeof createPlacement>>
      );
      if (!r.ok || !r.id) {
        setMsg(r.msg || "만들지 못했습니다.");
        return;
      }
      router.push(`${detailBase}/${r.id}`);
    });
  }

  if (!options.length) {
    return <div className="card text-sm text-slate-500">아직 입학테스트에 쓸 수 있는 문항(정답이 확정된 기출)이 없습니다.</div>;
  }

  return (
    <div className="card space-y-4">
      <div className="space-y-2">
        <p className="label">학년</p>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const k = `${o.level}${o.grade}`;
            const on = k === pick;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPick(k);
                  setSubject("");
                  setItems(null);
                }}
                className={"rounded-full border px-3 py-1 text-sm " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}
              >
                {k} <span className={on ? "text-slate-300" : "text-slate-400"}>({o.n})</span>
              </button>
            );
          })}
        </div>
        {opt && opt.subjects.length > 0 && (
          <>
            <p className="label">과목</p>
            <div className="flex flex-wrap gap-2">
              {[{ name: "", n: opt.n }, ...opt.subjects].map((s) => (
                <button
                  key={s.name || "all"}
                  type="button"
                  onClick={() => {
                    setSubject(s.name);
                    setItems(null);
                  }}
                  className={
                    "rounded-full border px-3 py-1 text-sm " +
                    (subject === s.name ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")
                  }
                >
                  {s.name || "전체"} <span className={subject === s.name ? "text-slate-300" : "text-slate-400"}>({s.n})</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className="text-sm text-slate-600 flex items-center gap-2">
            문항 수
            <select className="input w-auto py-1" value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[8, 10, 12, 15].map((k) => (
                <option key={k} value={k}>
                  {k}문항
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={pending || !scope} onClick={() => draw()}>
            {pending && !items ? "뽑는 중…" : items ? "다시 뽑기" : "문항 뽑기"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          쉬운 문항(하)부터 어려운 문항(상)까지 고르게(10문항이면 하 2 · 중하 2 · 중 3 · 중상 2 · 상 1), 단원이 겹치지 않게 뽑아 쉬운 순서로
          늘어놓습니다. 배점은 합 100점입니다.
        </p>
      </div>

      {items && (
        <div className="space-y-2">
          <h2 className="font-medium text-sm">
            {label} · {items.length}문항
          </h2>
          <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((it, i) => (
              <li key={it.id} className="flex items-start gap-2 p-2 text-sm">
                <span className="w-6 shrink-0 text-right font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + (DIFF_CLS[it.difficulty] ?? "bg-slate-100")}>{it.difficulty}</span>
                    <span className="text-slate-700">{it.unit || it.area || "단원 미상"}</span>
                    <span className="text-xs text-slate-400">
                      {it.examName.replace(/_/g, " ")} {it.label}번 · {it.type}
                    </span>
                  </div>
                  {it.statement ? (
                    <div
                      className="text-xs leading-6 text-slate-600 max-h-12 overflow-hidden break-words"
                      dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, it.statement) }}
                    />
                  ) : (
                    <p className="text-xs text-slate-400">(문제 글 없음 — 시험지에는 원래 문항 그림으로 나옵니다)</p>
                  )}
                  {it.answer && (
                    <p className="text-xs text-emerald-700">
                      정답 <span dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, it.answer) }} />
                    </p>
                  )}
                </div>
                <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" disabled={pending} onClick={() => swap(i)}>
                  바꾸기
                </button>
              </li>
            ))}
          </ol>
          <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="테스트 이름" aria-label="테스트 이름" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={pending || items.length < 5} onClick={make}>
              {confirming ? `${cost}P를 쓰고 만들기 — 한 번 더 누르세요` : kind === "tutor" && cost > 0 ? `입학테스트 만들기 (${cost}P)` : "입학테스트 만들기"}
            </button>
            {kind === "tutor" && balance !== undefined && <span className="text-xs text-slate-500">보유 {balance}P</span>}
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-amber-700">{msg}</p>}
    </div>
  );
}
