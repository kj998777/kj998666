-- 0029 — 과외선생님 링크로 들어온 학생 제출을 전부 "과외" 반 하나로 모은다 (2026-09-29 원장님 요청)
--
-- 전에는 선생님마다 반 이름이 "과외-aB3dE9"처럼 달라 관리자 화면에서 흩어져 보였다. 이제 반 이름은 모두 "과외"이고,
-- 어느 선생님 학생인지는 submissions.tutor_id로 구분한다(관리자 화면 반 관리 → 과외 반에서 선생님별로 볼 수 있음).
--
-- 반 이름이 같아지면 서로 다른 선생님의 학생이 같은 시험에 같은 이름으로 낼 때 "이미 같은 이름으로 제출" 오류가
-- 날 수 있으므로, 중복 제출 막기 기준을 (시험, 반, 이름) → (시험, 반, 이름, 과외선생님)으로 바꾼다.
-- 학원 학생(tutor_id 없음)은 예전과 똑같이 (시험, 반, 이름)으로 막힌다.
-- 여러 번 실행해도 안전하다.

-- 1. 새 중복 방지 기준(먼저 만들어 두고)
create unique index if not exists submissions_exam_class_name_tutor_uniq
  on public.submissions (exam_id, class_label, student_name, coalesce(tutor_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. 예전 기준 제거(0001에서 만든 unique 제약)
alter table public.submissions drop constraint if exists submissions_exam_id_class_label_student_name_key;

-- 3. 이미 들어온 과외 제출의 반 이름을 "과외"로 통일
update public.submissions
   set class_label = '과외'
 where tutor_id is not null
   and class_label is distinct from '과외';

-- 확인용:
--   select class_label, count(*) from public.submissions where tutor_id is not null group by 1;
--   select conname from pg_constraint where conrelid = 'public.submissions'::regclass;
