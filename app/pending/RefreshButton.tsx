"use client";

import { useState } from "react";

// 대기 화면 새로고침(2026-09-29 원장님 요청): 관리자가 권한을 지정해 준 뒤 누르면 서버가 역할을 다시 읽어
// 알맞은 홈(직원 /dashboard, 과외선생님 /tutor/dashboard)으로 바로 보낸다. 아직 대기면 이 화면이 그대로 다시 뜬다.
export default function RefreshButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-primary whitespace-nowrap py-1 px-2 text-xs sm:px-3 sm:text-sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        window.location.reload();
      }}
    >
      {busy ? "확인하는 중…" : "새로고침"}
    </button>
  );
}
