"use client";

import { useRef, useState, useTransition } from "react";
import { attachExamPdfOnly } from "../ai-actions";

/**
 * 이미 정답·해설이 있는 시험(마이그레이션된 시험 등)에 원본 PDF만 연결하는 폼.
 * UploadPdfForm과 달리 AI 자동 처리를 시작하지 않는다 — 이미 있는 정답·해설을
 * 덮어쓰거나 불필요한 AI 비용이 드는 일을 막기 위함.
 */
export default function AttachPdfForm({ code }: { code: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      action={(formData) => {
        setMsg(null);
        start(async () => {
          const r = await attachExamPdfOnly(code, formData);
          setMsg({ ok: r.ok, text: r.msg ?? "" });
          if (r.ok) formRef.current?.reset();
        });
      }}
    >
      <input type="file" name="pdf" accept="application/pdf" required className="text-sm" />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "저장하는 중…" : "원본 PDF만 저장 (AI 처리 안 함)"}
      </button>
      {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</span>}
    </form>
  );
}
