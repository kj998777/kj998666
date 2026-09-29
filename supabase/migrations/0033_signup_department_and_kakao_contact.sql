-- 0033 — 회원가입 "과" 선택 + 대기 화면의 원장님 카카오톡 안내 (2026-09-29 원장님 요청)
--
-- 1) profiles.department: 의대 / 수의대 / 약대 / 간호대. 회원가입 화면에서 고른다.
--    의대는 기수("30기"), 나머지는 학번("21학번" 또는 학번 전체)을 받는데, 둘 다 기존 cohort 열에 넣는다
--    (사람 표시 "30기 홍길동" / "21학번 홍길동"을 쓰는 모든 화면이 그대로 동작). 학번이 길 수 있어 cohort 길이를 20자로 늘린다.
-- 2) handle_new_user(): 가입 요청의 department·cohort·display_name만 받는다. 권한은 0021처럼 항상 '대기'.
-- 3) site_contact(한 줄): 대기 화면에 띄울 원장님 카카오톡 ID·링크·QR 그림. 계정 관리 화면에서 관리자만 고친다.
--    공개 저장소에 개인 연락처를 넣지 않으려고 코드가 아니라 DB에 둔다. 대기 계정도 로그인은 돼 있으니 읽기는 로그인한 사람 모두.
-- 여러 번 실행해도 안전하다. 0032 다음에 실행.

alter table public.profiles add column if not exists department text;
alter table public.profiles drop constraint if exists profiles_department_chk;
alter table public.profiles add constraint profiles_department_chk
  check (department is null or department in ('의대', '수의대', '약대', '간호대'));

alter table public.profiles drop constraint if exists profiles_cohort_len;
alter table public.profiles add constraint profiles_cohort_len
  check (cohort is null or char_length(cohort) between 1 and 20);

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
  if v_dept is not null and v_dept not in ('의대', '수의대', '약대', '간호대') then
    v_dept := null;
  end if;
  -- 권한은 항상 '대기'(0021 보안 수정 유지). 관리자 초대는 앱 서버가 초대 직후 profiles.role을 따로 바꾼다.
  insert into public.profiles (id, email, role, display_name, cohort, department)
  values (new.id, new.email, '대기', v_name, v_cohort, v_dept);
  return new;
end;
$$;

create table if not exists public.site_contact (
  id boolean primary key default true check (id),
  kakao_id text check (kakao_id is null or char_length(kakao_id) <= 60),
  kakao_url text check (kakao_url is null or char_length(kakao_url) <= 300),
  kakao_qr text check (kakao_qr is null or char_length(kakao_qr) <= 400000), -- QR 그림(data: URL, 브라우저에서 줄여서 저장)
  note text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now()
);
insert into public.site_contact (id) values (true) on conflict (id) do nothing;

alter table public.site_contact enable row level security;

drop policy if exists "site_contact_select_signed_in" on public.site_contact;
create policy "site_contact_select_signed_in"
  on public.site_contact for select to authenticated using (true);

drop policy if exists "site_contact_update_admin" on public.site_contact;
create policy "site_contact_update_admin"
  on public.site_contact for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, update on public.site_contact to authenticated;

-- 확인용: 과 열·연락처 표·새 가입 함수가 적용됐는지(모두 1 / true)
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'department') as 과_열,
  (select count(*) from public.site_contact) as 연락처_줄,
  (select prosrc like '%department%' from pg_proc where proname = 'handle_new_user') as 가입함수_새버전;
