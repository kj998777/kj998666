"use client";

import { useEffect, useState } from "react";

// 2026-10-01 친구 초대(0046): 내 초대 링크 + 복사. 링크 주소는 지금 열린 사이트 주소로 만든다.
export default function InviteCard({ code, invited, rewarded }: { code: string | null; invited: number; rewarded: number }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!code) return null;
  const link = `${origin || "https://medicchart.vercel.app"}/login?invite=${code}`;
  const text = `메딕차트에서 기출 검토하고 포인트로 기출문제 받아요. 이 링크로 가입하면 둘 다 +3P! ${link}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("아래 글을 복사해 주세요", text);
    }
  }
  return (
    <div className="card space-y-2 border-sky-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">친구 초대</h2>
        <span className="text-xs text-slate-500 tabular-nums">
          초대한 선생님 {invited}명 · 보너스 받음 {rewarded}명
        </span>
      </div>
      <p className="text-sm text-slate-600">
        이 링크로 가입한 선생님이 원장님 승인을 받고 <b>문항 3개를 제출하면</b>, 두 분 모두 <b>+3P</b>를 받습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{link}</code>
        <button type="button" className="btn-secondary py-1.5 px-3 text-sm" onClick={copy}>
          {copied ? "복사했어요" : "링크 복사"}
        </button>
      </div>
      <p className="text-xs text-slate-400">초대 코드 {code} · 카톡으로 보낼 안내 글까지 함께 복사됩니다.</p>
    </div>
  );
}
