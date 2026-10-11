-- 0055 (2026-10-11 원장님 "예상 등급컷이 나와 있는 경우 해당 등급컷도 성적 산출에 반영")
--   exams.grade_cuts: 고3 사설 모의고사 해설지에 실린 전국 예상 등급컷(원점수, 선택과목별)
--   모양: {"확통":[82,72,64], "미적":[82,72,64], "기하":[80,72,67]} — 1등급컷부터 차례로. 보고서가 학생 점수·선택과목으로
--   예상 등급을 낸다(lib/exams/mockCsat.ts expectedGrade). 시험 화면에서 원장님이 적거나, 해설지 정답 읽기 때 AI가 함께 읽음.
alter table public.exams add column if not exists grade_cuts jsonb;
comment on column public.exams.grade_cuts is '선택과목별 예상 등급컷(원점수) {과목: [1컷, 2컷, ...]} — lib/exams/mockCsat.ts';

-- 확인
select count(*) as 새_칸 from information_schema.columns where table_schema = 'public' and table_name = 'exams' and column_name = 'grade_cuts';
