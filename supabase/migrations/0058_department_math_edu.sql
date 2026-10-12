-- 0058 (2026-10-12 사용자 요청 "수학교육과 계정도 만들어줘")
--   회원가입 "과"에 수학교육과를 더한다. 의대가 아닌 과와 똑같이 학번을 받고(profiles.cohort),
--   이름 표시·기수별 순위는 "수학교육과 21학번"처럼 묶인다(personLabel, tutor_cohort_group은 의대 외 과를 그대로 붙이므로 손볼 것 없음).
--   간호대는 화면에서만 뺐고 예전 계정 값이 남아 있어 DB 허용 목록에는 그대로 둔다.
-- 여러 번 실행해도 안전하다. 0057 다음에 실행.

alter table public.profiles drop constraint if exists profiles_department_chk;
alter table public.profiles add constraint profiles_department_chk
  check (department is null or department in ('의대', '수의대', '약대', '간호대', '수학교육과'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 30), '');
  v_cohort text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'cohort', '')), 20), '');
  v_dept text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'department', '')), '');
begin
  if v_dept is not null and v_dept not in ('의대', '수의대', '약대', '간호대', '수학교육과') then
    v_dept := null;
  end if;
  -- 권한은 항상 '대기'(0021 보안 수정 유지). 관리자 초대는 앱 서버가 초대 직후 profiles.role을 따로 바꾼다.
  insert into public.profiles (id, email, role, display_name, cohort, department)
  values (new.id, new.email, '대기', v_name, v_cohort, v_dept);
  return new;
end;
$$;

-- 확인
select pg_get_constraintdef(oid) like '%수학교육과%' as 제약_수학교육과,
       (select prosrc like '%수학교육과%' from pg_proc where proname = 'handle_new_user') as 가입함수_수학교육과
from pg_constraint where conname = 'profiles_department_chk';
