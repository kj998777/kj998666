"use client";

// #2(2026-09-28): 시험지 PDF를 브라우저에서 Supabase Storage(exam-pdfs 버킷)에 직접 올린다.
//
// Vercel 서버리스 함수는 요청 본문이 플랫폼 자체 한도(무료 플랜 기준 약 4.5MB)로 제한돼 있어(Next.js
// 설정으로는 못 늘림) 예전처럼 PDF를 서버 액션(FormData)에 실어 보내는 방식으로는 몇 MB 이상을 절대
// 올릴 수 없었다. 그래서 브라우저가 Supabase Storage에 곧바로(=서버를 거치지 않고) 파일을 올리고,
// 서버 액션은 그 뒤에 "이미 올라온 파일"의 메타데이터만 정리한다(쪽수 세기·exam_pdf_meta 기록·AI
// 자동 처리/디지털화 시작 등 — lib/ai/pdf.ts의 finalizePdfUpload, app/(staff)/exams/ai-actions.ts의
// finalize* 계열 함수 참고). 이 통로가 실제로 열리려면 storage.objects의 INSERT/UPDATE RLS 정책이
// 로그인한 직원(editor 이상)을 허용해야 하는데, 그건 0015 마이그레이션에서 손봤다.

import { createClient } from "./client";

// Storage 버킷(exam-pdfs) 자체에도 같은 상한이 걸려 있다(0015 마이그레이션, file_size_limit) —
// 여기 값을 바꾸면 그쪽도 맞춰 바꿔야 한다.
export const PDF_MAX_BYTES = 20 * 1024 * 1024; // 20MB

export function pdfTooLarge(file: File | Blob): boolean {
  return file.size > PDF_MAX_BYTES;
}

/** 시험 id 앞으로 PDF를 Storage에 직접 올린다(이미 있으면 덮어씀 — upsert). */
export async function uploadPdfDirect(examId: string, file: File | Blob): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from("exam-pdfs").upload(`${examId}.pdf`, file, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error("PDF를 올리지 못했습니다: " + error.message);
}
