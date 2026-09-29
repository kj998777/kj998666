"use client";

import { useEffect } from "react";

// 사이트 어디서든 예상 못 한 오류가 나면 전에는 흰 화면에 영어 "Application error: a client-side exception has
// occurred"만 떴다(2026-09-29 과외선생님 신고). 이제 한국어 안내와 새로고침·다시 시도 버튼을 보여 준다.
// (적던 검토 답·풀이, 버그 신고 글은 이 기기에 임시 저장돼 있어 새로고침해도 되살아난다.)
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("app error boundary", error);
  }, [error]);
  const isSkew = /server action|failed to find|unexpected response|chunk|loading css|dynamically imported/i.test(
    String(error?.message ?? "")
  );
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <h1 className="text-lg font-semibold">화면을 불러오는 중 문제가 생겼어요</h1>
      <p className="text-sm text-slate-600">
        {isSkew
          ? "사이트가 방금 업데이트됐어요. 새로고침하면 바로 해결됩니다."
          : "잠깐 연결이 불안정했거나 예상하지 못한 오류가 났어요. 새로고침 후 다시 시도해 주세요."}
      </p>
      <p className="text-xs text-slate-500">
        적고 있던 답·풀이 글은 이 기기에 저장돼 있어 새로고침해도 다시 불러옵니다(사진은 다시 올려 주세요).
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button className="btn-primary" onClick={() => window.location.reload()}>
          새로고침
        </button>
        <button className="btn-secondary" onClick={() => reset()}>
          다시 시도
        </button>
      </div>
      {error?.digest && <p className="text-[11px] text-slate-400">오류 번호: {error.digest}</p>}
      <p className="text-xs text-slate-500">계속되면 메뉴의 &lsquo;버그 신고&rsquo;로 알려 주세요.</p>
    </main>
  );
}
