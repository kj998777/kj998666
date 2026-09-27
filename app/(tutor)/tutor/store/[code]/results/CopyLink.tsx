"use client";

import { useEffect, useState } from "react";

// 서버 렌더링 시점엔 실제 도메인(origin)을 모르므로 일단 상대 경로만 보여주다가, 브라우저에
// 마운트되면 window.location.origin을 붙인 절대 URL로 바꿔서 보여준다.
export default function CopyLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.origin + path);
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 API를 못 쓰는 환경이면 그냥 무시 — 아래 글자를 직접 선택해서 복사하면 된다.
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <code className="text-xs bg-slate-100 px-2 py-1 rounded break-all">{url}</code>
      <button type="button" className="btn-secondary py-1 px-2 text-xs" onClick={copy}>
        {copied ? "복사됨!" : "링크 복사"}
      </button>
    </div>
  );
}
