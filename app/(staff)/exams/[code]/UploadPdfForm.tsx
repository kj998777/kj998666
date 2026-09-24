"use client";

import { useRef, useState, useTransition } from "react";
import { uploadPdfAndStartAi } from "../ai-actions";

export default function UploadPdfForm({ code }: { code: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      action={(formData) => {
        setMsg("");
        start(async () => {
          const r = await uploadPdfAndStartAi(code, formData);
          if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
          else formRef.current?.reset();
        });
      }}
    >
      <input type="file" name="pdf" accept="application/pdf" required className="text-sm" />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "올리는 중…" : "시험지 PDF 올리고 AI 자동 처리 시작"}
      </button>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </form>
  );
}
