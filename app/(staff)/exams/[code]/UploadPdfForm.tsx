"use client";

import { useRef, useState, useTransition } from "react";
import { finalizeUploadPdfAndStartAi } from "../ai-actions";
import { pdfTooLarge, uploadPdfDirect } from "@/lib/supabase/uploadPdf";
import PdfDropInput from "../PdfDropInput";

/**
 * #2(2026-09-28): PDF는 이제 브라우저가 Supabase Storage에 곧바로 올린다(최대 50MB — Vercel
 * 서버리스 함수의 요청 본문 제한을 우회하기 위함, lib/supabase/uploadPdf.ts 참고). 업로드가 끝난
 * 뒤에야 서버 액션(finalizeUploadPdfAndStartAi)을 불러 AI 자동 처리를 시작한다.
 * "스캔본입니다" 체크박스를 켜면 업로드 직후 디지털화(startDigitizeJob)도 같이 시작한다 — "이 PDF가
 * 스캔본인지" 자동 판별 기능은 없으므로(lib/ai/pdfMeta.ts) 직원이 직접 표시해야 한다.
 */
export default function UploadPdfForm({ code, examId }: { code: string; examId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(formData) => {
        setMsg("");
        const file = formData.get("pdf");
        if (!(file instanceof File) || file.size === 0) {
          setMsg("시험지 PDF 파일을 선택해 주세요.");
          return;
        }
        if (pdfTooLarge(file)) {
          setMsg("PDF 용량이 너무 큽니다(50MB 이하로 줄여서 올려 주세요).");
          return;
        }
        const isScanned = formData.get("is_scanned") === "on";
        start(async () => {
          try {
            await uploadPdfDirect(examId, file);
          } catch (e: any) {
            setMsg(String(e?.message ?? e));
            return;
          }
          const r = await finalizeUploadPdfAndStartAi(code, { isScanned, startDigitize: isScanned });
          if (!r.ok) setMsg(r.msg ?? "실패했습니다.");
          else formRef.current?.reset();
        });
      }}
    >
      <PdfDropInput name="pdf" required compact />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "올리는 중…" : "시험지 PDF 올리고 AI 자동 처리 시작"}
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-sm text-slate-600">
        <input type="checkbox" name="is_scanned" />
        스캔본입니다(디지털화 필요) — 업로드 후 자동으로 디지털화를 시작합니다
      </label>
      <p className="text-xs text-slate-400">최대 50MB</p>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </form>
  );
}
