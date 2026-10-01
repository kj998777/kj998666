"use client";

import { useEffect, useState } from "react";
import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import { addToCart, onCartChange, readCart, writeCart, CART_MAX } from "@/lib/bank/cart";
import ProblemPageImage from "@/app/(tutor)/tutor/review/[itemId]/ProblemPageImage";

export type ResultRow = {
  id: string;
  examCode: string;
  examName: string;
  label: string;
  area: string;
  unit: string;
  difficulty: string;
  type: string;
  statement: string;
  answer: string;
  confirmed: boolean;
  hasLocation: boolean;
};

const DIFF_CLS: Record<string, string> = { 하: "bg-green-600", 중하: "bg-lime-600", 중: "bg-yellow-600", 중상: "bg-orange-600", 상: "bg-red-600" };

function Original({ row }: { row: ResultRow }) {
  const [d, setD] = useState<{ sourcePage: number | null; bbox: any } | null | undefined>(undefined);
  useEffect(() => {
    let off = false;
    fetch("/bank/items", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [row.id] }) })
      .then((r) => r.json())
      .then((j) => !off && setD(j?.items?.[0] ?? null))
      .catch(() => !off && setD(null));
    return () => {
      off = true;
    };
  }, [row.id]);
  if (d === undefined) return <p className="text-xs text-slate-400">불러오는 중…</p>;
  return (
    <ProblemPageImage paged pdfUrl={`/exams/${encodeURIComponent(row.examCode)}/original-pdf`} label={row.label} page={d?.sourcePage ?? null} bbox={d?.bbox ?? null} />
  );
}

export default function BankResults({ rows }: { rows: ResultRow[]; allIds?: string[] }) {
  const katex = useKatex();
  const [cart, setCart] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    setCart(readCart());
    return onCartChange(setCart);
  }, []);
  const inCart = new Set(cart);

  if (!rows.length) return <div className="card text-sm text-slate-500">조건에 맞는 문항이 없습니다. 조건을 줄여 보세요.</div>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="btn-secondary py-1 px-3 text-sm"
          onClick={() => {
            const n = addToCart(rows.map((r) => r.id));
            setNote(n > 0 ? `${n}문항을 담았습니다.` : cart.length >= CART_MAX ? `담을 수 있는 최대 ${CART_MAX}문항입니다.` : "이미 모두 담겨 있어요.");
          }}
        >
          이 쪽 문항 모두 담기
        </button>
        {note && <span className="text-slate-500">{note}</span>}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const on = inCart.has(r.id);
          return (
            <li key={r.id} className={"card space-y-2 " + (on ? "ring-2 ring-sky-300" : "")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm min-w-0">
                  <span className="font-medium">
                    {r.examName.replace(/_/g, " ")} · {r.label}번
                  </span>
                  <span className="ml-2 text-slate-500">
                    {[r.area, r.unit].filter(Boolean).join(" › ")}
                  </span>
                  <span className={"ml-2 rounded-full px-2 text-[11px] font-bold text-white " + (DIFF_CLS[r.difficulty] ?? "bg-yellow-600")}>{r.difficulty}</span>
                  {r.type && <span className="ml-1 text-xs text-slate-400">{r.type}</span>}
                  {!r.confirmed && <span className="ml-1 badge bg-amber-100 text-amber-800">정답 확정 전</span>}
                </div>
                <button
                  type="button"
                  className={(on ? "btn-secondary" : "btn-primary") + " py-1 px-3 text-sm shrink-0"}
                  onClick={() => (on ? writeCart(cart.filter((x) => x !== r.id)) : addToCart([r.id]))}
                >
                  {on ? "빼기" : "담기"}
                </button>
              </div>
              {r.statement ? (
                <div className="text-sm leading-7 break-words max-h-40 overflow-hidden" dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, r.statement) }} />
              ) : (
                <p className="text-xs text-slate-400">문제 글이 없습니다 — 원본으로 확인해 주세요.</p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-slate-600">
                  정답 <b dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, r.answer || "-") }} />
                </span>
                <button type="button" className="text-sky-700 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? "원본 닫기" : "원본 문제 보기"}
                </button>
              </div>
              {open === r.id && <Original row={r} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
