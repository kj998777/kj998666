"use client";

import { useState } from "react";

// 글 복사 버튼(대기 화면: 카카오톡으로 보낼 가입 정보·원장님 카카오톡 ID). 복사가 막힌 환경이면 글을 골라 두어 직접 복사하게 한다.
export default function CopyButton({ text, label = "복사", targetId }: { text: string; label?: string; targetId?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary whitespace-nowrap py-1 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          const el = targetId ? document.getElementById(targetId) : null;
          if (el) {
            const r = document.createRange();
            r.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          }
        }
      }}
    >
      {done ? "복사했어요" : label}
    </button>
  );
}
