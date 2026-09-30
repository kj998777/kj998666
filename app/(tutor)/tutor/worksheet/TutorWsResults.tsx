"use client";

import { useEffect, useState } from "react";
import { useKatex } from "@/app/_components/MathTools";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import { tutorCart } from "@/lib/bank/cart";
import type { TutorBankItem } from "@/lib/bank/tutorLoad";

const DIFF_CLS: Record<string, string> = { 하: "bg-green-600", 중하: "bg-lime-600", 중: "bg-yellow-600", 중상: "bg-orange-600", 상: "bg-red-600" };

// 맞춤 시험지 문항 찾기 결과(정답·해설은 만든 뒤 해설지에서만 보인다)
export default function TutorWsResults({ rows, price }: { rows: TutorBankItem[]; price: Record<string, number> }) {
  const katex = useKatex();
  const [cart, setCart] = useState<string[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => {
    setCart(tutorCart.read());
    return tutorCart.onChange(setCart);
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
            const n = tutorCart.add(rows.map((r) => r.id));
            setNote(n > 0 ? `${n}문항을 담았습니다.` : cart.length >= tutorCart.max ? `한 시험지에 ${tutorCart.max}문항까지입니다.` : "이미 모두 담겨 있어요.");
          }}
        >
          이 쪽 문항 모두 담기
        </button>
        {note && <span className="text-slate-500">{note}</span>}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const on = inCart.has(r.id);
          const free = price[r.examId] === 0;
          return (
            <li key={r.id} className={"card space-y-2 " + (on ? "ring-2 ring-sky-300" : "")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm min-w-0">
                  <span className="font-medium">
                    {r.examName.replace(/_/g, " ")} · {r.label}번
                  </span>
                  <span className="ml-2 text-slate-500">{[r.area, r.unit].filter(Boolean).join(" › ")}</span>
                  <span className={"ml-2 rounded-full px-2 text-[11px] font-bold text-white " + (DIFF_CLS[r.difficulty] ?? "bg-yellow-600")}>{r.difficulty}</span>
                  {r.type && <span className="ml-1 text-xs text-slate-400">{r.type}</span>}
                  {free && <span className="ml-1 badge bg-emerald-100 text-emerald-700">산 시험 · 무료</span>}
                </div>
                <button
                  type="button"
                  className={(on ? "btn-secondary" : "btn-primary") + " py-1 px-3 text-sm shrink-0"}
                  onClick={() => (on ? tutorCart.write(cart.filter((x) => x !== r.id)) : tutorCart.add([r.id]))}
                >
                  {on ? "빼기" : "담기"}
                </button>
              </div>
              {r.statement ? (
                <div className="text-sm leading-7 break-words max-h-32 overflow-hidden text-slate-700" dangerouslySetInnerHTML={{ __html: renderMathHtml(katex, r.statement) }} />
              ) : (
                <p className="text-xs text-slate-400">문제 요약이 없습니다.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
