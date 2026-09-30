"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDigitizedOk } from "@/app/(staff)/exams/[code]/digitize-actions";

export default function OkButton({ code, pageNo, itemIndex }: { code: string; pageNo: number; itemIndex: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className="text-sm text-slate-600 hover:underline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await markDigitizedOk(code, pageNo, itemIndex, true);
            if (!r.ok) setErr(r.msg ?? "실패");
            else router.refresh();
          })
        }
      >
        {pending ? "…" : "문제없음"}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </>
  );
}
