-- #2 (신규 요청): 기출문제 업로드 용량 확대(20MB) + 스캔본 자동 디지털화 연계.
--
-- 1) 업로드 아키텍처 변경(앱 코드, 이 마이그레이션과 별도 커밋): Vercel 서버리스 함수의 요청 본문
--    크기는 플랫폼 자체 한도(약 4.5MB)라 Next.js 설정으로는 못 늘린다. 그래서 PDF 원본 바이트는
--    이제 브라우저가 Supabase Storage(exam-pdfs 버킷)에 곧바로 올리고, 서버 액션은 그 뒤에
--    메타데이터 정리(쪽수 세기, exam_pdf_meta 기록, AI 자동 처리/디지털화 시작)만 담당한다
--    (lib/ai/pdf.ts의 finalizePdfUpload, app/(staff)/exams/ai-actions.ts). 이 변경으로 "직원 로그인
--    세션(anon key)이 곧바로 Storage에 파일을 쓸 수 있어야" 하므로, 그 통로가 되는
--    storage.objects/exam_pdf_meta 쓰기 정책을 아래에서 손본다 — 원장님 확인(2026-09-28, 20MB로
--    확대, 브라우저→Storage 직접 업로드 방식 채택).
--
-- 2) 발견된 기존 버그 수정: app/(staff)/exams/ai-actions.ts의 attachExamPdfOnly는 주석과 역할 검사
--    (requireRole("editor"))가 "editor 이상이면 원본 PDF만 저장할 수 있다"고 되어 있지만, 실제로
--    거치는 storage.objects/exam_pdf_meta INSERT·UPDATE 정책은 0002에서 is_admin()만 허용해 두어서
--    editor 계정은 실제로는 항상 RLS 오류로 실패했다(실제 editor 계정으로 한 번도 검증된 적이 없어
--    이번에 업로드 경로를 다시 살펴보다 발견). 원래 의도대로 is_editor_or_admin()으로 넓힌다 — 이번에
--    브라우저 직접 업로드로 옮기면서 이 정책을 그대로 다시 쓰게 되므로 지금 같이 고친다.
--
-- 3) 스캔본 자동 디지털화(#2 기능): "이 PDF가 스캔본인지" 자동 판별 기능은 여전히 없다(lib/ai/pdfMeta.ts
--    에 문서화된 기존 결정 — pdf-lib 비공식 내부 API에 기대는 위험을 피함, 이번에도 바꾸지 않는다).
--    대신 업로드 화면에 "스캔본입니다(디지털화 필요)" 체크박스를 추가해 직원이 직접 표시하면, 업로드
--    완료 직후 자동으로 디지털화 작업(startDigitizeJob)을 시작한다. 디지털화가 끝나면(dg_done)
--    관리자가 원클릭 "디지털 시험지를 원본으로 적용" 버튼을 눌러 그 결과를 시험의 원본 PDF로 바로
--    바꿔치기할 수 있다(예전에는 다운로드 후 수동 재업로드가 필요했음) — 그 적용 여부를 구분해
--    보여주기 위해 exam_pdf_meta에 열을 하나 추가한다. (조판 자체(buildDigitizedPdf.ts)는 브라우저
--    캔버스·pdf.js·html2canvas·KaTeX에 의존하는 순수 브라우저 코드라 Vercel 서버 함수에서는 실행할
--    수 없어, "원클릭 적용"까지가 이번 범위다 — 마찬가지로 원장님 확인(2026-09-28).)

alter table public.exam_pdf_meta
  add column if not exists replaced_with_digitized boolean not null default false;

comment on column public.exam_pdf_meta.replaced_with_digitized is
  '#2: 디지털화 결과를 "원클릭 적용" 버튼으로 원본 PDF에 덮어썼으면 true(이 경우 is_scanned도 함께
   false로 갱신됨 — 더 이상 스캔본이 아니라 다시 조판한 깨끗한 버전이므로).';

-- exam_pdf_meta: insert/update를 admin 전용 → editor 이상으로 넓힌다(위 2번 버그 수정).
drop policy if exists "exam_pdf_meta_write_admin" on public.exam_pdf_meta;
drop policy if exists "exam_pdf_meta_update_admin" on public.exam_pdf_meta;
create policy "exam_pdf_meta_write_editor"
  on public.exam_pdf_meta for insert to authenticated with check (public.is_editor_or_admin());
create policy "exam_pdf_meta_update_editor"
  on public.exam_pdf_meta for update to authenticated using (public.is_editor_or_admin()) with check (public.is_editor_or_admin());

-- storage.objects(exam-pdfs 버킷): insert/update를 admin 전용 → editor 이상으로 넓힌다(같은 이유).
-- 브라우저 직접 업로드는 곧 이 정책을 통해서만 허용되므로, 여기를 넓히지 않으면 editor 계정은
-- attachExamPdfOnly는커녕 그 어떤 PDF도 브라우저에서 직접 올릴 수 없게 된다.
drop policy if exists "exam_pdfs_storage_write_admin" on storage.objects;
drop policy if exists "exam_pdfs_storage_update_admin" on storage.objects;
create policy "exam_pdfs_storage_write_editor"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exam-pdfs' and public.is_editor_or_admin());
create policy "exam_pdfs_storage_update_editor"
  on storage.objects for update to authenticated
  using (bucket_id = 'exam-pdfs' and public.is_editor_or_admin())
  with check (bucket_id = 'exam-pdfs' and public.is_editor_or_admin());

-- Storage 버킷 자체에도 20MB 상한을 걸어 둔다 — 클라이언트 쪽 용량 검사(20MB)를 우회해도 Storage가
-- 한 번 더 막도록 하는 이중 방어(app/(staff)/exams 쪽 업로드 폼들이 하는 20MB 검사와 같은 값).
update storage.buckets set file_size_limit = 20971520 where id = 'exam-pdfs';

-- =========================================================================
-- 이 마이그레이션을 Supabase SQL 편집기에 붙여넣고 실행하세요.
-- 실행 후 확인할 것:
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='exam_pdf_meta' and column_name='replaced_with_digitized';
--   select policyname from pg_policies where tablename='exam_pdf_meta';
--   select policyname from pg_policies where schemaname='storage' and tablename='objects'
--     and policyname like 'exam_pdfs_storage%';
--   select file_size_limit from storage.buckets where id='exam-pdfs';  -- 20971520 이어야 함
-- =========================================================================
