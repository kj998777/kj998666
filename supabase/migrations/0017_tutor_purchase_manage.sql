-- #4 (2026-09-28): 과외선생님 구매 관리 화면.
--
-- 원장님 결정(AskUserQuestion, 2026-09-28):
--   (1) 과외선생님이 구매한 시험의 해설·정답을 고치면 원본에 바로 반영하지 않고 "수정 요청"으로
--       올린다 → 관리자가 검토현황(/admin/review-status)에서 채택/거절. (학원 학생 채점에 쓰는
--       정답표가 외부에서 바로 바뀌지 않도록)
--   (2) 과외선생님의 제출 현황·보고서에는 "본인 전용 링크(/s/코드?t=토큰)로 제출한 학생만" 보인다.
--       지금까지(0010)는 그 시험의 모든 제출 — 학원 학생 이름·점수까지 — 이 과외선생님에게 보였다.
--       그 정책을 이번에 좁힌다. 이미 들어와 있는 제출은 누가 받은 것인지 알 수 없으므로(기록이 없었음)
--       과외선생님 화면에서는 더 이상 보이지 않는다(직원 화면에서는 그대로 보임).
--
-- 바꾸는 점:
--   1. tutor_links — 과외선생님별 제출 링크 토큰(앱 서버가 서비스롤로 처음 필요할 때 만든다).
--   2. submissions.tutor_id — 과외선생님 링크로 들어온 제출에 기록.
--   3. submit_and_grade — p_tutor_id 인자 추가(서비스롤로만 호출되는 학생 제출 API가 넘김).
--   4. submissions / grading_results 과외선생님 열람 RLS를 "본인 링크 제출"로 좁힘.
--   5. tutor_edit_requests — 해설·정답 수정 요청.

-- -------------------------------------------------------------------------
-- 1. tutor_links
-- -------------------------------------------------------------------------
create table if not exists public.tutor_links (
  tutor_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) between 6 and 40),
  created_at timestamptz not null default now()
);

alter table public.tutor_links enable row level security;

drop policy if exists "tutor_links_select_own_or_admin" on public.tutor_links;
create policy "tutor_links_select_own_or_admin"
  on public.tutor_links for select to authenticated
  using (tutor_id = auth.uid() or public.is_admin());

grant select on public.tutor_links to authenticated;
-- insert/update는 정책이 없으므로 서비스롤(앱 서버)만 가능.

-- -------------------------------------------------------------------------
-- 2. submissions.tutor_id
-- -------------------------------------------------------------------------
alter table public.submissions
  add column if not exists tutor_id uuid references public.profiles (id) on delete set null;

create index if not exists submissions_exam_tutor_idx on public.submissions (exam_id, tutor_id);

comment on column public.submissions.tutor_id is
  '#4: 과외선생님 전용 링크(/s/코드?t=토큰)로 들어온 제출이면 그 과외선생님. 학원 링크 제출은 null.';

-- -------------------------------------------------------------------------
-- 3. submit_and_grade — 0010 본문 + p_tutor_id. 시그니처가 바뀌므로 옛 6-인자 버전은 지운다
--    (남겨 두면 오버로드로 공존해 헷갈림). 앱은 이 마이그레이션 이후 항상 7-인자로 호출한다.
-- -------------------------------------------------------------------------
drop function if exists public.submit_and_grade(text, text, text, jsonb, jsonb, numeric);

create or replace function public.submit_and_grade(
  p_exam_code text,
  p_class_label text,
  p_student_name text,
  p_answers jsonb,
  p_per_item jsonb,
  p_total_score numeric,
  p_tutor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_status text;
  v_tutor_cost int;
  v_submission_id uuid;
begin
  select id, status, tutor_download_cost into v_exam_id, v_status, v_tutor_cost
  from public.exams
  where code = p_exam_code
  for update;

  if v_exam_id is null then
    raise exception '존재하지 않는 시험입니다.' using errcode = 'P0020';
  end if;

  if p_tutor_id is not null then
    -- 과외선생님 링크: 그 과외선생님이 이 시험을 구매했어야 한다(시험 상태와 무관).
    if not exists (
      select 1 from public.tutor_exam_purchases p where p.exam_id = v_exam_id and p.tutor_id = p_tutor_id
    ) then
      raise exception '이 링크로는 이 시험을 제출할 수 없습니다.' using errcode = 'P0023';
    end if;
  elsif v_status <> '열림' and v_tutor_cost is null then
    raise exception '이 시험은 지금 제출을 받지 않습니다.' using errcode = 'P0021';
  end if;

  begin
    insert into public.submissions (exam_id, class_label, student_name, answers, tutor_id)
    values (v_exam_id, p_class_label, p_student_name, p_answers, p_tutor_id)
    returning id into v_submission_id;
  exception
    when unique_violation then
      raise exception '이미 같은 이름으로 제출한 기록이 있습니다.' using errcode = 'P0022';
  end;

  insert into public.grading_results (submission_id, exam_id, per_item, total_score)
  values (v_submission_id, v_exam_id, p_per_item, p_total_score);

  return v_submission_id;
end;
$$;

-- 서비스롤 전용(학생 제출 API)으로만 쓴다. 이전 버전은 권한을 따로 막지 않아, 공개된 anon 키로
-- 누구나 이 함수를 직접 불러 반 검증·채점을 건너뛰고 점수(p_total_score)를 마음대로 넣을 수 있는
-- 허점이 있었다 — 이번에 막는다.
revoke all on function public.submit_and_grade(text, text, text, jsonb, jsonb, numeric, uuid) from public, anon, authenticated;
grant execute on function public.submit_and_grade(text, text, text, jsonb, jsonb, numeric, uuid) to service_role;

-- -------------------------------------------------------------------------
-- 4. 과외선생님 열람 범위: 본인 링크로 들어온 제출만
-- -------------------------------------------------------------------------
drop policy if exists "submissions_select_tutor_purchased" on public.submissions;
drop policy if exists "submissions_select_tutor_own" on public.submissions;
create policy "submissions_select_tutor_own"
  on public.submissions for select to authenticated
  using (public.is_tutor() and tutor_id = auth.uid());

drop policy if exists "grading_results_select_tutor_purchased" on public.grading_results;
drop policy if exists "grading_results_select_tutor_own" on public.grading_results;
create policy "grading_results_select_tutor_own"
  on public.grading_results for select to authenticated
  using (
    public.is_tutor()
    and exists (
      select 1 from public.submissions s
      where s.id = grading_results.submission_id and s.tutor_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------------
-- 5. tutor_edit_requests — 해설·정답 수정 요청
-- -------------------------------------------------------------------------
create table if not exists public.tutor_edit_requests (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null check (char_length(item_label) between 1 and 20),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  proposed_answer text not null default '' check (char_length(proposed_answer) <= 200),
  proposed_solution text not null default '' check (char_length(proposed_solution) <= 4000),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposed_answer <> '' or proposed_solution <> '' or note <> '')
);

create index if not exists tutor_edit_requests_status_idx on public.tutor_edit_requests (status, created_at);

alter table public.tutor_edit_requests enable row level security;

drop policy if exists "tutor_edit_requests_select_own_or_admin" on public.tutor_edit_requests;
create policy "tutor_edit_requests_select_own_or_admin"
  on public.tutor_edit_requests for select to authenticated
  using (tutor_id = auth.uid() or public.is_admin());

-- 과외선생님은 "본인이 구매한 시험"에 대해서만, 본인 이름으로, 대기(pending) 상태로만 올릴 수 있다.
drop policy if exists "tutor_edit_requests_insert_tutor_purchased" on public.tutor_edit_requests;
create policy "tutor_edit_requests_insert_tutor_purchased"
  on public.tutor_edit_requests for insert to authenticated
  with check (
    public.is_tutor()
    and tutor_id = auth.uid()
    and status = 'pending'
    and resolved_by is null
    and exists (
      select 1 from public.tutor_exam_purchases p
      where p.exam_id = tutor_edit_requests.exam_id and p.tutor_id = auth.uid()
    )
  );

drop policy if exists "tutor_edit_requests_update_admin" on public.tutor_edit_requests;
create policy "tutor_edit_requests_update_admin"
  on public.tutor_edit_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.tutor_edit_requests to authenticated;

-- -------------------------------------------------------------------------
-- 확인용:
--   select count(*) from public.tutor_links;
--   select proname, pronargs from pg_proc where proname = 'submit_and_grade';  -- 7 하나만 있어야 함
-- -------------------------------------------------------------------------
