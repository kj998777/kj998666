"use client";

import { useEffect, useState } from "react";
import { onCartChange, readCart, writeCart, CART_MAX } from "@/lib/bank/cart";
import type { BankDetail } from "@/lib/bank/load";

// 담은 문항 목록 + 시험지 만들기. 목록은 이 기기에 저장(lib/bank/cart.ts), 자세한 내용은 /bank/items에서 읽는다.
export default function CartPanel() {
  const [ids, setIds] = useState<string[]>([]);
  const [items, setItems] = useState<BankDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("메딕수학 복습 시험지");
  const [subtitle, setSubtitle] = useState("");
  const [showSource, setShowSource] = useState(true);
  const [cover, setCover] = useState(true); // 2026-10-01: 앞뒤 표지(메딕수학 표지 + 뒤 로고)
  const [perCol, setPerCol] = useState<2 | 3>(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setIds(readCart());
    try {
      const t = localStorage.getItem("mc-bank-title");
      if (t) setTitle(t);
    } catch {
      /* 무시 */
    }
    return onCartChange(setIds);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mc-bank-title", title);
    } catch {
      /* 무시 */
    }
  }, [title]);

  useEffect(() => {
    let off = false;
    if (!ids.length) {
      setItems([]);
      return;
    }
    setLoading(true);
    fetch("/bank/items", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) })
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        const got: BankDetail[] = j?.items ?? [];
        const by = new Map(got.map((x) => [x.id, x]));
        setItems(ids.map((id) => by.get(id)).filter((x): x is BankDetail => !!x));
      })
      .catch(() => !off && setMsg("담은 문항을 불러오지 못했습니다. 새로고침해 주세요."))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [ids]);

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    writeCart(next);
  }

  async function build(kind: "sheet" | "answer") {
    if (!items.length) return;
    setBusy(true);
    setMsg("");
    try {
      const mod = await import("./buildWorksheet");
      const { downloadBytes } = await import("@/app/(staff)/exams/[code]/results/buildReportPdf");
      const opts = { title: title.trim() || "메딕수학 복습 시험지", subtitle: subtitle.trim(), showSource, perCol, cover: cover ? ("worksheet" as const) : undefined };
      const safe = opts.title.replace(/[\\/:*?"<>|\s]+/g, "_");
      if (kind === "sheet") {
        const r = await mod.buildWorksheetPdf(items, opts, setMsg);
        downloadBytes(r.bytes, `${safe}.pdf`);
        setMsg(
          `시험지 ${r.pages}쪽을 받았습니다.` +
            (r.textFallback.length ? ` 원본에서 자리를 못 찾은 ${r.textFallback.length}문항(${r.textFallback.slice(0, 3).join(", ")}${r.textFallback.length > 3 ? " 등" : ""})은 옮겨 적은 글로 넣었어요 — 그림이 빠졌을 수 있으니 확인해 주세요.` : "")
        );
      } else {
        const bytes = await mod.buildAnswerPdf(items, opts, setMsg);
        downloadBytes(bytes, `${safe}_정답해설.pdf`);
        setMsg("정답·해설지를 받았습니다.");
      }
    } catch (e: any) {
      setMsg("만들지 못했습니다: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  const unconfirmed = items.filter((x) => !x.confirmed).length;
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">담은 문항 {ids.length}개</h2>
        {ids.length > 0 &&
          (confirmClear ? (
            <span className="flex gap-2 text-xs">
              <button type="button" className="text-red-600 hover:underline" onClick={() => {
                  writeCart([]);
                  setConfirmClear(false);
                }}>
                정말 비우기
              </button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setConfirmClear(false)}>
                취소
              </button>
            </span>
          ) : (
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setConfirmClear(true)}>
              모두 빼기
            </button>
          ))}
      </div>
      {!ids.length ? (
        <p className="text-sm text-slate-500">왼쪽에서 문항을 찾아 &ldquo;담기&rdquo;를 누르세요(최대 {CART_MAX}개). 학생 분석 화면의 &ldquo;복습지 만들기&rdquo;로도 담을 수 있어요.</p>
      ) : (
        <ol className="space-y-1 max-h-80 overflow-y-auto text-sm">
          {ids.map((id, i) => {
            const it = items.find((x) => x.id === id);
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="w-6 text-right tabular-nums text-slate-400">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate" title={it ? `${it.examName} ${it.label}번` : ""}>
                  {it ? `${it.unit || it.area || "단원 미상"} · ${it.difficulty}` : loading ? "…" : "(찾을 수 없음)"}
                  {it && <span className="text-xs text-slate-400"> · {it.examName.replace(/_/g, " ").slice(0, 14)} {it.label}번</span>}
                </span>
                <button type="button" className="px-1 text-slate-500 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                  ↑
                </button>
                <button type="button" className="px-1 text-slate-500 disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                  ↓
                </button>
                <button type="button" className="px-1 text-slate-400 hover:text-red-600" onClick={() => writeCart(ids.filter((x) => x !== id))} aria-label="빼기">
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {unconfirmed > 0 && <p className="text-xs text-amber-700">정답이 아직 확정되지 않은 문항 {unconfirmed}개가 있어요. 해설지 정답을 한 번 확인해 주세요.</p>}
      <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} placeholder="시험지 제목" aria-label="시험지 제목" />
        <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value.slice(0, 80))} placeholder="부제(예: 고1 2반 · 이차방정식 복습)" aria-label="부제" />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
          앞뒤 표지 붙이기(메딕수학 표지·뒤 로고)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} />
          문항마다 출처(시험·번호·단원) 적기
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={perCol === 2} onChange={(e) => setPerCol(e.target.checked ? 2 : 3)} />
          풀이 공간 넉넉히(한 단에 2문항)
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy || !items.length} onClick={() => build("sheet")}>
            {busy ? "만드는 중…" : "시험지 PDF"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy || !items.length} onClick={() => build("answer")}>
            정답·해설지 PDF
          </button>
        </div>
        {msg && <p className="text-xs text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
