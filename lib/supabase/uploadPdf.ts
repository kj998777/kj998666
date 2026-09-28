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

/**
 * 시험 id 앞으로 PDF를 Storage에 직접 올린다. 올린 경로를 돌려준다.
 *
 * 버그 수정(2026-09-28, "디지털화 원본 적용 후에도 PDF 다운로드가 예전 시험지로 나옴"): 예전에는 항상
 * 같은 경로(`<examId>.pdf`)에 덮어썼는데, Storage는 파일을 기본 1시간 캐시 헤더와 함께 내려주고 서버 쪽
 * fetch도 URL 단위로 캐시될 수 있어, 덮어쓴 직후 같은 URL로 받으면 예전 파일이 나올 수 있었다. 그래서
 * 올릴 때마다 새 경로(`<examId>/<시각>.pdf`)를 쓴다 — 서버의 finalizePdfUpload(lib/ai/pdf.ts)가 가장
 * 최근 파일을 골라 exam_pdf_meta.storage_path로 가리키고, 이전 버전은 지운다.
 */
export async function uploadPdfDirect(examId: string, file: File | Blob): Promise<string> {
  const supabase = createClient();
  const path = `${examId}/${Date.now()}.pdf`;
  const { error } = await supabase.storage.from("exam-pdfs").upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw new Error("PDF를 올리지 못했습니다: " + error.message);
  return path;
}
