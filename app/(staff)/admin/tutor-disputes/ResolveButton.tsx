"use client";

import { useState, useTransition } from "react";
import { resolveDispute } from "./actions";

export default function ResolveButton({ primaryReviewId }: { primaryReviewId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  if (done) return <p className="text-sm text-emerald-600">확인 완료로 표시했습니다.</p>;

  return (
    <div className="flex items-center gap-2">
      <button
        className="btn-secondary py-1 px-3"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await resolveDispute(primaryReviewId);
            if (!r.ok) {
              setErr(r.msg ?? "실패");
              return;
            }
            setDone(true);
          })
        }
      >
        확인함
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
