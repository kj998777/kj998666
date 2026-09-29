// 진행 상황 확인을 서버 액션 대신 일반 요청(fetch)으로 부르는 도우미(2026-09-29 최적화 — app/(staff)/exams/[code]/poll/route.ts 참고).
// ok=false면 이번 확인이 실패한 것이므로 화면은 이전 상태를 그대로 두고 다음 주기에 다시 확인하면 된다.
export async function pollJob<T>(
  code: string,
  kind: "ai" | "digitize" | "errcheck",
  label?: string
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const r = await fetch(`/exams/${encodeURIComponent(code)}/poll`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, label }),
    });
    if (!r.ok || r.redirected) return { ok: false };
    const j = await r.json().catch(() => null);
    if (!j?.ok) return { ok: false };
    return { ok: true, data: j.data as T };
  } catch {
    return { ok: false };
  }
}

/** 다른 탭을 보고 있으면 false — 그동안은 확인을 쉰다(작업 자체는 서버의 1분 자동 작업이 계속 진행). */
export function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
