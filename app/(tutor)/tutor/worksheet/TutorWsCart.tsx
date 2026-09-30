"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tutorCart } from "@/lib/bank/cart";
import { worksheetCost } from "@/lib/bank/cost";
import { createTutorWorksheet, tutorCartInfo } from "./actions";
import { refreshTutorStats } from "@/app/(tutor)/TutorHeaderStats";

type Info = { id: string; examId: string; examName: string; label: string; unit: string; difficulty: string };

// 담은 문항 + 값 + 만들기(2026-09-30). 값 계산은 lib/bank/cost.ts(=DB 함수와 같은 셈), 실제 차감은 DB 함수가 한다.
export default function TutorWsCart({ price, balance }: { price: Record<string, number>; balance: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [info, setInfo] = useState<Info[]>([]);
  const [title, setTitle] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    setIds(tutorCart.read());
    return tutorCart.onChange(setIds);
  }, []);
  useEffect(() => {
    let off = false;
    if (!ids.length) {
      setInfo([]);
      return;
    }
    tutorCartInfo(ids)
      .then((r) => !off && setInfo(r))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [ids]);

  const byId = new Map(info.map((x) => [x.id, x]));
  const known = ids.map((id) => byId.get(id)).filter((x): x is Info => !!x);
  const cost = worksheetCost(known.map((x) => x.examId), price);
  const short = cost > balance;

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    tutorCart.write(next);
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">담은 문항 {ids.length}개</h2>
        {ids.length > 0 && (
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => tutorCart.write([])}>
            모두 빼기
          </button>
        )}
      </div>
      {!ids.length ? (
        <p className="text-sm text-slate-500">왼쪽에서 문항을 찾아 &ldquo;담기&rdquo;를 누르세요(최대 {tutorCart.max}문항).</p>
      ) : (
        <ol className="space-y-1 max-h-72 overflow-y-auto text-sm">
          {ids.map((id, i) => {
            const it = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="w-6 text-right tabular-nums text-slate-400">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate" title={it ? `${it.examName} ${it.label}번` : ""}>
                  {it ? `${it.unit || "단원 미상"} · ${it.difficulty}` : "…"}
                  {it && <span className="text-xs text-slate-400"> · {it.examName.replace(/_/g, " ").slice(0, 12)} {it.label}번</span>}
                </span>
                <button type="button" className="px-1 text-slate-500 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                  ↑
                </button>
                <button type="button" className="px-1 text-slate-500 disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                  ↓
                </button>
                <button type="button" className="px-1 text-slate-400 hover:text-red-600" onClick={() => tutorCart.write(ids.filter((x) => x !== id))} aria-label="빼기">
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
        <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="시험지 제목(예: 고1 이차함수 복습)" aria-label="시험지 제목" />
        <p className="text-slate-600">
          값 <b className="tabular-nums">{cost}P</b> <span className="text-xs text-slate-400">(보유 {balance}P)</span>
        </p>
        {short && <p className="text-xs text-red-600">포인트가 모자라요. 문항을 줄이거나 검토로 포인트를 모아 주세요.</p>}
        {!confirm ? (
          <button type="button" className="btn-primary w-full" disabled={!ids.length || short || pending} onClick={() => setConfirm(true)}>
            {cost ? `${cost}P로 시험지 만들기` : "무료로 시험지 만들기"}
          </button>
        ) : (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
            <p className="text-xs text-amber-900">
              {cost ? `${cost}P를 쓰고 ` : ""}
              {ids.length}문항 시험지를 만듭니다. 만든 뒤에는 정답·해설도 볼 수 있고, 포인트는 되돌릴 수 없어요.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary py-1 px-3 text-sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg("");
                    const r = await createTutorWorksheet(ids, title);
                    if (!r.ok || !r.id) {
                      setMsg(r.msg ?? "만들지 못했습니다.");
                      setConfirm(false);
                      return;
                    }
                    tutorCart.write([]);
                    refreshTutorStats();
                    router.push(`/tutor/worksheet/${r.id}`);
                  })
                }
              >
                {pending ? "만드는 중…" : "만들기"}
              </button>
              <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => setConfirm(false)}>
                취소
              </button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-red-600">{msg}</p>}
      </div>
    </div>
  );
}
