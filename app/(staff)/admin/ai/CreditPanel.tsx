"use client";

import { useState, useTransition } from "react";
import { clearBalanceAction, clearLowAlertAction, saveBalanceAction } from "./actions";
import type { CreditInfo } from "@/lib/ai/settings";

function usd(n: number) {
  return "$" + n.toFixed(2);
}

export default function CreditPanel({ initial }: { initial: CreditInfo }) {
  const [info, setInfo] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-4">
      {info.low && (
        <div className="rounded border border-red-300 bg-red-50 text-red-700 text-sm p-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{info.low.kind === "credit" ? "크레딧 부족" : "사용 한도 도달"}</p>
            <p>{info.low.message}</p>
          </div>
          <button
            className="btn-secondary shrink-0"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await clearLowAlertAction();
                setInfo({ ...info, low: null });
              })
            }
          >
            확인함
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-slate-500">누적 사용액 (since {new Date(info.since).toLocaleDateString("ko-KR")})</p>
          <p className="text-lg font-semibold">{usd(info.spent)}</p>
        </div>
        <div>
          <p className="text-slate-500">처리한 시험 / 시험당 평균</p>
          <p className="text-lg font-semibold">
            {info.exams}개 {info.exams > 0 && `· ${usd(info.avg)}`}
          </p>
        </div>
      </div>

      <a href={info.url} target="_blank" rel="noreferrer" className="text-sm underline text-sky-700">
        Anthropic 결제 페이지에서 크레딧 충전/확인 →
      </a>

      <div className="border-t border-slate-200 pt-3">
        <p className="text-sm font-medium mb-1">잔액 추정</p>
        <p className="text-xs text-slate-500 mb-2">
          Anthropic API는 잔액 조회 기능이 없어, 마지막으로 확인한 잔액을 직접 입력해 두면 이후 사용량만큼 빼서 대략 추정해 드립니다.
        </p>
        {info.bal ? (
          <div className="text-sm space-y-1">
            <p>
              {new Date(info.bal.at!).toLocaleDateString("ko-KR")} 기준 {usd(info.bal.usd)} 입력 → 이후 사용 {usd(info.bal.used)} →
              추정 잔액 <span className="font-semibold">{usd(info.bal.est)}</span>
            </p>
            {info.bal.exams != null && <p className="text-slate-500">약 {info.bal.exams}개 시험 더 처리 가능(평균 기준)</p>}
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await clearBalanceAction();
                  setInfo({ ...info, bal: null });
                })
              }
            >
              추정 지우기
            </button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            action={(formData) => {
              setMsg(null);
              start(async () => {
                const r = await saveBalanceAction(formData);
                if (!r.ok) setMsg({ ok: false, text: r.msg });
                else setMsg({ ok: true, text: "저장했습니다." });
              });
            }}
          >
            <input name="balance" className="input max-w-[140px]" placeholder="예: 23.45" />
            <button type="submit" className="btn-primary" disabled={pending}>
              저장
            </button>
          </form>
        )}
        {msg && <p className={"text-sm mt-1 " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
      </div>
    </div>
  );
}
