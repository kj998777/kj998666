-- 0053 (2026-10-11 원장님 "고3 사설모의고사도 입력·제출할 수 있게 — 디지털화·해설 작성 없이 문제지·해설지를 내가 둘 다 올리게")
--   exams.mock_csat        : 고3 수능형 사설 모의고사(공통 1~22 + 선택과목 23~30, 학생이 제출할 때 선택과목을 고름)
--   exams.solution_pdf_path: 원장님이 올린 해설지 PDF(exam-pdfs 버킷 _solutions/<시험 id>/<시각>.pdf)
-- 정답표는 기존 answer_key 그대로 — 선택과목 문항은 번호 앞에 과목을 붙인다("확통23", "미적23", "기하23" …, lib/exams/mockCsat.ts).
-- 해설지 보기: 직원은 시험 화면, 과외선생님은 산 시험의 관리 화면(서비스롤로 구매 확인 뒤 내려줌) — 버킷 RLS는 그대로.
alter table public.exams add column if not exists mock_csat boolean not null default false;
alter table public.exams add column if not exists solution_pdf_path text;
comment on column public.exams.mock_csat is '고3 수능형 사설 모의고사(선택과목 23~30) — lib/exams/mockCsat.ts';
comment on column public.exams.solution_pdf_path is '원장님이 올린 해설지 PDF 경로(exam-pdfs 버킷)';

-- 확인
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'exams' and column_name in ('mock_csat', 'solution_pdf_path')) as 새_칸;
