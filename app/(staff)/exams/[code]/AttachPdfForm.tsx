"use client";

import { useRef, useState, useTransition } from "react";
import { finalizeAttachExamPdfOnly } from "../ai-actions";
import { pdfTooLarge, uploadPdfDirect } from "@/lib/supabase/uploadPdf";
import PdfDropInput from "../PdfDropInput";

/**
 * 이미 정답·해설이 있는 시험(마이그레이션된 시험 등)에 원본 PDF만 연결하는 폼.
 * UploadPdfForm과 달리 AI 자동 처리를 시작하지 않는다 — 이미 있는 정답·해설을
 * 덮어쓰거나 불필요한 AI 비용이 드는 일을 막기 위함.
 *
 * #2(2026-09-28): PDF는 이제 브라우저가 Supabase Storage에 곧바로 올린다(최대 50MB — Vercel
 * 서버리스 함수의 요청 본문 제한을 우회하기 위함, lib/supabase/uploadPdf.ts 참고). 업로드가 끝난
 * 뒤에야 서버 액션(finalizeAttachExamPdfOnly)을 불러 뒷정리한다.
 */
export default function AttachPdfForm({ code, examId }: { code: string; examId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(formData) => {
        setMsg(null);
        const file = formData.get("pdf");
        if (!(file instanceof File) || file.size === 0) {
          setMsg({ ok: false, text: "시험지 PDF 파일을 선택해 주세요." });
          return;
        }
        if (pdfTooLarge(file)) {
          setMsg({ ok: false, text: "PDF 용량이 너무 큽니다(50MB 이하로 줄여서 올려 주세요)." });
          return;
        }
        start(async () => {
          try {
            await uploadPdfDirect(examId, file);
          } catch (e: any) {
            setMsg({ ok: false, text: String(e?.message ?? e) });
            return;
          }
          const r = await finalizeAttachExamPdfOnly(code);
          setMsg({ ok: r.ok, text: r.msg ?? "" });
          if (r.ok) formRef.current?.reset();
        });
      }}
    >
      <PdfDropInput name="pdf" required compact />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장하는 중…" : "원본 PDF만 저장 (AI 처리 안 함, 최대 50MB)"}
        </button>
        {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</span>}
      </div>
    </form>
  );
}
