"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExamRow, finalizeAiExamUpload } from "./ai-actions";
import { pdfTooLarge, uploadPdfDirect } from "@/lib/supabase/uploadPdf";

export default function CreateAiExamForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [step, setStep] = useState("");
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setMsg("");
        const file = formData.get("pdf");
        if (!(file instanceof File) || file.size === 0) {
          setMsg("시험지 PDF 파일을 선택해 주세요.");
          return;
        }
        // #2(2026-09-28): PDF 바이트는 서버 액션이 아니라 브라우저가 Supabase Storage에 곧바로
        // 올린다(lib/supabase/uploadPdf.ts) — Vercel 서버리스 함수의 요청 본문 크기 제한(약
        // 4.5MB, Next.js 설정으로는 못 늘림)을 우회해 20MB까지 지원하기 위함(예전에는 이 제한
        // 때문에 4MB로 막혀 있었다 — 2026-09-28 원장님 신고로 발견된 문제).
        if (pdfTooLarge(file)) {
          setMsg("PDF 용량이 너무 큽니다(20MB 이하로 줄여서 올려 주세요).");
          return;
        }
        const isScanned = formData.get("is_scanned") === "on";
        start(async () => {
          setStep("시험 만드는 중…");
          const created = await createExamRow(formData);
          if (!created.ok) {
            setMsg(created.msg);
            setStep("");
            return;
          }
          setStep("PDF 올리는 중…");
          try {
            await uploadPdfDirect(created.id, file);
          } catch (e: any) {
            // 시험 행은 이미 만들어졌으니, PDF 업로드 실패는 시험 상세 화면에서 다시 시도할 수
            // 있게 안내만 하고 그리로 보낸다(UploadPdfForm으로 재업로드 가능).
            router.push(
              `/exams/${encodeURIComponent(created.code)}?aiErr=${encodeURIComponent(
                ("PDF 업로드 실패: " + String(e?.message ?? e)).slice(0, 200)
              )}`
            );
            return;
          }
          setStep("AI 자동 처리 시작하는 중…");
          const r = await finalizeAiExamUpload(created.code, { isScanned, startDigitize: isScanned });
          const url =
            `/exams/${encodeURIComponent(created.code)}` +
            (r.aiErr ? `?aiErr=${encodeURIComponent(r.aiErr.slice(0, 200))}` : "");
          router.push(url);
        });
      }}
    >
      <div>
        <label className="label">시험 코드</label>
        <input name="code" className="input" placeholder="dg2025-mid" required />
      </div>
      <div>
        <label className="label">시험 이름</label>
        <input name="name" className="input" placeholder="대기고 1-2 공통수학2 중간고사" required />
      </div>
      <div>
        <label className="label">학교급</label>
        <select name="school_level" className="input" defaultValue="">
          <option value="">선택 안 함</option>
          <option value="초">초등학교</option>
          <option value="중">중학교</option>
          <option value="고">고등학교</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">연도</label>
          <input name="folder_year" className="input" placeholder="2026" />
        </div>
        <div>
          <label className="label">학년</label>
          <select name="folder_grade" className="input">
            <option value="">선택 안 함</option>
            <option value="1">1학년</option>
            <option value="2">2학년</option>
            <option value="3">3학년</option>
          </select>
        </div>
        <div>
          <label className="label">학기</label>
          <select name="folder_term" className="input">
            <option value="">선택 안 함</option>
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </select>
        </div>
        <div>
          <label className="label">구분</label>
          <select name="folder_kind" className="input">
            <option value="">선택 안 함</option>
            <option value="중간">중간고사</option>
            <option value="기말">기말고사</option>
            <option value="기타">기타</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">시험지 PDF</label>
        <input type="file" name="pdf" accept="application/pdf" required className="text-sm" />
        <p className="text-xs text-slate-500 mt-1">
          AI가 문항을 읽어 정답·해설을 자동으로 만듭니다. 다 되면 검수 화면에서 확인 후 시험을 열면 됩니다.
          (최대 20MB)
        </p>
        <label className="flex items-center gap-1.5 text-sm mt-1">
          <input type="checkbox" name="is_scanned" />
          스캔본입니다(디지털화 필요) — 업로드 후 자동으로 디지털화를 시작합니다
        </label>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? step || "처리하는 중…" : "만들고 AI 자동 처리 시작"}
      </button>
    </form>
  );
}
