-- 0036 — 학번(학생증 번호, 예: 2025XXXXXX) 저장 + 승인 때 필수 + 중복 계정 차단 (2026-09-29 원장님 요청)
--
-- - 학번은 관리자만 본다. profiles(직원이면 누구나 읽을 수 있음)에 넣지 않고 따로 표(student_numbers)를 만들고,
--   읽기 정책은 관리자(is_admin())만, 쓰기 정책은 아예 없다(아래 관리자 전용 함수로만 쓴다).
-- - 한 학번은 한 계정에만: student_no에 unique. 이미 다른 계정에 있는 학번이면 승인 함수가 거절하고 그 계정을 알려 준다.
-- - 대기 → 다른 권한으로 바꿀 때는 학번이 저장돼 있어야 한다(트리거). 관리자 권한으로 바꾸는 경우와
--   관리자가 이메일로 초대한 계정(auth.users.invited_at 있음)은 예외.
-- - 이미 승인된 계정은 그대로 둔다(학번이 없어도 됨). 나중에 계정 관리에서 채워 넣을 수 있다.
-- - 계정을 지우면(auth.users 삭제 → profiles 삭제) 학번도 같이 지워진다.
-- 여러 번 실행해도 안전하다. 0035 다음에 실행.

create or replace function public.normalize_student_no(p text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '');
$$;

create table if not exists public.student_numbers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  student_no text not null unique check (student_no ~ '^[0-9A-Z]{4,20}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.student_numbers enable row level security;
revoke all on public.student_numbers from anon;
revoke insert, update, delete on public.student_numbers from authenticated;
grant select on public.student_numbers to authenticated;

drop policy if exists "student_numbers_select_admin" on public.student_numbers;
create policy "student_numbers_select_admin"
  on public.student_numbers for select to authenticated using (public.is_admin());

-- 대기 → 승인 때 학번 필수
create or replace function public.enforce_student_no_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = '대기' and new.role is distinct from '대기' and new.role <> 'admin'
     and not exists (select 1 from public.student_numbers s where s.user_id = new.id)
     and not exists (select 1 from auth.users u where u.id = new.id and u.invited_at is not null) then
    raise exception '학번을 먼저 저장해야 승인할 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_student_no_on_approval on public.profiles;
create trigger trg_enforce_student_no_on_approval
  before update of role on public.profiles
  for each row execute function public.enforce_student_no_on_approval();

-- 학번 저장(관리자만). p_student_no가 비면 지운다.
-- 결과: {ok:true} 또는 {ok:false, reason:'duplicate'|'format'|..., other_email, other_name}
create or replace function public.admin_set_student_no(p_user_id uuid, p_student_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no text := public.normalize_student_no(p_student_no);
  v_other uuid;
  v_email text;
  v_name text;
  v_cohort text;
  v_dept text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;
  if v_no is null then
    delete from public.student_numbers where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  if v_no !~ '^[0-9A-Z]{4,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'format');
  end if;
  select user_id into v_other from public.student_numbers where student_no = v_no and user_id <> p_user_id;
  if v_other is not null then
    select email, display_name, cohort, department into v_email, v_name, v_cohort, v_dept from public.profiles where id = v_other;
    return jsonb_build_object('ok', false, 'reason', 'duplicate', 'other_email', v_email, 'other_name', v_name,
                              'other_cohort', v_cohort, 'other_department', v_dept);
  end if;
  insert into public.student_numbers (user_id, student_no, updated_at, updated_by)
  values (p_user_id, v_no, now(), auth.uid())
  on conflict (user_id) do update set student_no = excluded.student_no, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'duplicate');
end;
$$;

-- 학번 저장 + 권한 변경을 한 번에(둘 중 하나라도 실패하면 둘 다 안 됨)
create or replace function public.admin_approve_with_student_no(p_user_id uuid, p_student_no text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if public.normalize_student_no(p_student_no) is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  r := public.admin_set_student_no(p_user_id, p_student_no);
  if not coalesce((r ->> 'ok')::boolean, false) then
    return r;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_student_no(uuid, text) from public, anon;
revoke all on function public.admin_approve_with_student_no(uuid, text, text) from public, anon;
grant execute on function public.admin_set_student_no(uuid, text) to authenticated;
grant execute on function public.admin_approve_with_student_no(uuid, text, text) to authenticated;

-- 확인용(모두 1 / true)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'student_numbers') as 학번_표,
  (select count(*) from pg_trigger where tgname = 'trg_enforce_student_no_on_approval') as 승인_트리거,
  (select count(*) from pg_proc where proname = 'admin_approve_with_student_no') as 승인_함수,
  (select relrowsecurity from pg_class where relname = 'student_numbers') as 보안_켜짐;
