"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// 과외선생님 화면 위쪽 숫자(포인트 · 맡은 문제). 레이아웃은 화면을 옮겨도 다시 그려지지 않아서(Next 레이아웃 유지),
// 검토 제출(고정 주소 API)처럼 서버 액션을 거치지 않는 동작 뒤에는 숫자가 예전 값으로 남았다(2026-09-30 제보).
// → 처음 값은 서버가 넣어 주고, 화면 이동·앱으로 돌아옴·"mc:tutor-stats" 신호(제출 직후 등) 때 /api/tutor/me로 다시 읽는다.

type Stats = { points: number; claims: number };
const EVENT = "mc:tutor-stats";
let latest: Stats | null = null;
let seq = 0;

/** 제출·구매 등 포인트가 바뀐 직후 부른다 */
export function refreshTutorStats() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

async function load(): Promise<void> {
  const my = ++seq;
  try {
    const r = await fetch("/api/tutor/me", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return;
    const j = await r.json();
    if (my !== seq || !j?.ok) return; // 늦게 온 옛 응답은 버린다
    latest = { points: Number(j.points ?? 0), claims: typeof j.claims === "number" ? j.claims : latest?.claims ?? 0 };
    window.dispatchEvent(new CustomEvent(EVENT + ":data", { detail: latest }));
  } catch {
    /* 연결이 끊겨도 화면은 그대로 둔다 */
  }
}

/** drive=true인 칸 하나만 다시 읽기를 맡는다(두 칸이 같은 요청을 두 번 보내지 않게) */
function useStats(initial: Stats, drive: boolean): Stats {
  const pathname = usePathname();
  const [s, setS] = useState<Stats>(latest ?? initial);
  useEffect(() => {
    const onData = (e: Event) => setS((e as CustomEvent<Stats>).detail);
    const onAsk = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(EVENT + ":data", onData);
    if (drive) {
      window.addEventListener(EVENT, onAsk);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      window.removeEventListener(EVENT + ":data", onData);
      window.removeEventListener(EVENT, onAsk);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 서버가 레이아웃을 새로 그렸으면(서버 액션 뒤 등) 그 값을 받는다
  useEffect(() => {
    setS(initial);
    latest = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.points, initial.claims]);
  // 화면을 옮길 때마다 다시 읽는다(첫 화면은 서버 값 그대로)
  const [first, setFirst] = useState(true);
  useEffect(() => {
    if (first) {
      setFirst(false);
      return;
    }
    if (drive) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return s;
}

export function PointsBadge({ points, claims }: Stats) {
  const s = useStats({ points, claims }, true);
  return <span className="badge bg-amber-100 text-amber-700 whitespace-nowrap">포인트 {s.points}</span>;
}

export function ClaimBadge({ points, claims }: Stats) {
  const s = useStats({ points, claims }, false);
  if (s.claims <= 0) return null;
  return <span className="ml-1 badge bg-red-100 text-red-700">{s.claims}</span>;
}
