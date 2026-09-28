-- #6: 최초 로그인(자기 가입)시 아무 권한도 없는 '대기' 역할을 새로 만든다.
--
-- 배경: app/login/page.tsx의 회원가입(supabase.auth.signUp)은 누구나 이메일만 있으면 바로 가입할
-- 수 있는 자율 가입 방식인데, 지금까지는 handle_new_user() 트리거가 raw_user_meta_data에 유효한
-- role이 없으면(=자율 가입은 항상 이 경우) 조용히 'viewer'로 fallback 하고 있었다 — 즉 지금까지는
-- 아무나 가입만 하면 즉시 뷰어 권한(시험·정답 조회 등 직원 화면 열람)을 자동으로 얻는 구조였다.
-- 이제는 그 fallback을 '대기'로 바꿔서, 관리자가 계정 관리 화면에서 직접 알맞은 권한(뷰어/편집자/
-- 관리자/과외선생님)으로 바꿔주기 전까지는 아무 화면도 못 보게 막는다.
--
-- '대기'는 admin/editor/viewer의 선형 계층(lib/auth/requireRole.ts의 RANK)에도, tutor 트랙
-- (lib/auth/requireTutor.ts)에도 속하지 않는 완전히 별개의 상태다 — RANK에 없는 role이라 passesRole()
-- 이 항상 false를 돌려주므로(이미 tutor 도입 때 고친 undefined-비교 함정 덕분에) 별도 코드 변경 없이
-- 직원 화면에서 자동으로 차단된다. 다만 requireRole()이 차단 시 돌려보내는 곳(/dashboard)이 그 자체로
-- 같은 계층 검사를 다시 통과해야 하는 화면이라, tutor나 '대기'가 실수로 직원 URL에 직접 들어오면
-- 무한 리다이렉트에 빠지는 문제가 있었다 — 이건 이 마이그레이션이 아니라 앱 코드(requireRole.ts)에서
-- 같이 고친다(역할별로 자기 자신의 홈으로 돌려보내도록).

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'editor', 'viewer', 'tutor', '대기'));

alter table public.profiles alter column role set default '대기';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  -- 관리자 초대(inviteUserByEmail)는 항상 이 네 값 중 하나를 raw_user_meta_data.role로 명시해서
  -- 보낸다(app/(staff)/admin/users/actions.ts의 isRole() 참고). 그 외의 모든 경우(자율 가입 —
  -- metadata 자체가 없음, 또는 알 수 없는 값)는 전부 '대기'로 떨어진다.
  v_role text := case
    when requested_role in ('admin', 'editor', 'viewer', 'tutor') then requested_role
    else '대기'
  end;
begin
  insert into public.profiles (id, email, role) values (new.id, new.email, v_role);
  if v_role = 'tutor' then
    insert into public.tutor_stats (tutor_id) values (new.id);
  end if;
  return new;
end;
$$;
