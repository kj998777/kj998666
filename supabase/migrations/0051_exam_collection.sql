-- 0051 (2026-10-05 요청 "부교재 변형문제 폴더"): 학교 기출이 아닌 메딕수학 자체 자료를
-- 이름 붙은 모음(분류)으로 따로 묶는다. 값이 있으면 시험 목록·기출 스토어에서 연도 폴더 대신
-- 맨 위 "분류" 폴더(예: 부교재 변형문제)에 들어간다. 비어 있으면(null) 지금과 똑같다.
alter table public.exams add column if not exists collection text;

-- 확인: select count(*) filter (where collection is not null) as in_collection from public.exams;  -- 0
