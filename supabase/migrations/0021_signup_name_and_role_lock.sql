-- 2026-09-28 원장님 요청 1·2: 회원가입 때 기수·이름 받기 + 새 가입자 승인 편의.
--
-- 이 마이그레이션이 하는 일:
--   1. profiles에 display_name(이름)·cohort(기수) 열 추가. 회원가입 화면에서 입력한 값이 들어간다.
--   2. ⚠️ 보안 수정 — handle_new_user()가 더 이상 가입 요청에 담긴 role 값을 믿지 않는다.
--      지금까지(0013)는 raw_user_meta_data.role이 admin/editor/viewer/tutor면 그 권한으로 계정을
--      만들었다. 관리자 초대만 이 값을 보낸다고 가정했지만, 회원가입(supabase.auth.signUp)도
--      options.data로 같은 칸에 아무 값이나 넣을 수 있고 공개된 anon 키만 있으면 누구나 호출할 수
--      있어서, 마음만 먹으면 회원가입만으로 "관리자" 계정을 만들 수 있는 구멍이었다.
--      이제 새 계정은 무조건 '대기'로 시작하고, 관리자 초대(app/(staff)/admin/users/actions.ts의
--      inviteUser)는 초대 직후 서버(서비스롤)에서 권한을 따로 지정한다.
--
-- 앱 코드는 이 마이그레이션 전에 배포돼도 동작하도록 만들어 두었다(이름·기수 열이 없으면 그 칸만
-- 비워 둠). 0020 다음에 실행.

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists cohort text;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) between 1 and 30);
alter table public.profiles drop constraint if exists profiles_cohort_len;
alter table public.profiles add constraint profiles_cohort_len
  check (cohort is null or char_length(cohort) between 1 and 10);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 30), '');
  v_cohort text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'cohort', '')), 10), '');
begin
  -- 권한은 항상 '대기'. 관리자 초대는 앱 서버가 초대 직후 profiles.role을 따로 바꾼다.
  insert into public.profiles (id, email, role, display_name, cohort)
  values (new.id, new.email, '대기', v_name, v_cohort);
  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- 확인용 1: 새 함수가 적용됐는지
--   select prosrc like '%raw_user_meta_data ->> ''role''%' as 옛날버전_남아있음
--   from pg_proc where proname = 'handle_new_user';          -- false여야 함
--
-- 확인용 2: 지금까지 이 구멍으로 권한을 얻은 계정이 있는지 눈으로 점검.
--   초대 메일로 만든 계정은 invited_at이 채워져 있다. 아래 목록에서 invited_at이 비어 있는데
--   관리자·편집자·뷰어·과외선생님인 계정이 원장님이 직접 권한을 바꿔 준 계정이 아니라면 삭제하세요.
--   select p.email, p.role, u.invited_at, p.created_at
--   from public.profiles p join auth.users u on u.id = p.id
--   where p.role <> '대기' order by p.created_at;
-- -------------------------------------------------------------------------
