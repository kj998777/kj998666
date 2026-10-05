-- 0051 (2026-10-05 원장님 "학생이 아니라 선생님이 선택할 수 있게"): 오답 유사문제를 선생님이 골라 준다.
-- 제출 하나(학생 시험 한 번)마다 선생님이 고른 유사문제를 적는 칸.
--   similar_picks: {"<틀린 문항 번호>": ["<item_explanations.id>", ...], ...}  — null이면 아직 안 고름
--   similar_picked_at / similar_picked_by: 마지막으로 고른 시각·사람(원장님·편집자 또는 그 학생의 과외선생님)
-- 학생 화면(/r/<제출 id>)은 선생님이 고른 문제만 보여 준다(고르기 전에는 "선생님이 골라 주시면 여기에 나와요").
-- 쓰기는 앱 서버가 권한(직원 editor 이상, 또는 submissions.tutor_id = 본인)을 확인한 뒤 서비스롤로만 한다 —
-- RLS 정책은 새로 만들지 않는다(기존 submissions 정책 그대로).
alter table public.submissions add column if not exists similar_picks jsonb
  check (similar_picks is null or jsonb_typeof(similar_picks) = 'object');
alter table public.submissions add column if not exists similar_picked_at timestamptz;
alter table public.submissions add column if not exists similar_picked_by uuid references public.profiles(id) on delete set null;
comment on column public.submissions.similar_picks is '선생님이 고른 오답 유사문제 {틀린 문항 번호: [item_explanations.id]} — null이면 아직 안 고름';

-- 확인
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name like 'similar_pick%') as 새_칸,
  (select count(*) from public.submissions where similar_picks is not null) as 고른_제출;
