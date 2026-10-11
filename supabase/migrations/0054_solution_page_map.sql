-- 0054 (2026-10-11 원장님 "보고서 만들 때 올린 해설에서 틀린 문제 해설을 찾아서 첨부해 줘")
--   exams.solution_page_map: 고3 사설 모의고사 해설지 PDF에서 문항별 풀이가 있는 쪽(1부터, PDF 쪽 순서)
--   모양: {"1":[3], "2":[3,4], "확통23":[30], ...} — AI가 찾고(app/(staff)/exams/[code]/solution-pages), 원장님이 고칠 수 있음.
--   개별 보고서가 틀린·무응답 문항의 이 쪽들을 해설지에서 잘라 보고서 뒤에 붙인다.
alter table public.exams add column if not exists solution_page_map jsonb;
comment on column public.exams.solution_page_map is '해설지 PDF 문항별 풀이 쪽 {label: [page,...]} — lib/exams/mockCsat.ts';

-- 확인
select count(*) as 새_칸 from information_schema.columns where table_schema = 'public' and table_name = 'exams' and column_name = 'solution_page_map';
