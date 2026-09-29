"use client";

import { useState, useTransition } from "react";
import { rescanExamQr } from "./actions";
import { actionErrorMessage } from "@/lib/actionError";

// 원본 속 QR 위치를 (다시) 찾게 하는 작은 버튼(관리자) — 2026-09-29
export default function QrScanButton({ code, label }: { code: string; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="text-xs text-brand-700 hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await rescanExamQr(code);
              setMsg(r.msg ?? "");
            } catch (e) {
              setMsg(actionErrorMessage(e).text);
            }
          })
        }
      >
        {pending ? "거는 중…" : label}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
