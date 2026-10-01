-- 0048 (2026-10-01 원장님 "50까지 올려"): 시험지 PDF 업로드 상한 20MB → 50MB.
-- Supabase 무료 플랜은 프로젝트 전체 업로드 상한이 50MB로 고정이라 이보다 크게는 못 올린다.
-- 화면 쪽 검사(lib/supabase/uploadPdf.ts PDF_MAX_BYTES)도 같은 값. 이미 저장된 파일은 그대로.
update storage.buckets set file_size_limit = 52428800 where id = 'exam-pdfs';

-- 확인: select id, file_size_limit from storage.buckets where id = 'exam-pdfs';  -- 52428800
