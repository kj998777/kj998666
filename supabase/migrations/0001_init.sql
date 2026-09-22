-- =========================================================================
-- 학원 시험관리 시스템 v1 — 초기 스키마 + RLS
-- Supabase SQL 편집기(Dashboard → SQL Editor)에 그대로 붙여넣고 실행하면 됩니다.
-- 순서대로 실행되도록 작성되어 있어 위에서부터 한 번에 돌려도 됩니다.
-- =========================================================================

-- pgcrypto: gen_random_uuid() 사용을 위해 필요 (Supabase 프로젝트는 보통 기본 활성화됨)
create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- 1. profiles — auth.users 와 1:1, 역할(admin/editor/viewer)을 저장
-- -------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is '직원 계정과 권한(admin/editor/viewer). auth.users 와 1:1.';

-- 역할 확인용 SECURITY DEFINER 함수 — RLS 정책이 profiles 를 재귀 조회하지 않도록 우회 경로 제공
create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_profile_role() is not null;
$$;

create or replace function public.is_editor_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_profile_role() in ('admin', 'editor');
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_profile_role() = 'admin';
$$;

-- 새 계정(초대 수락)이 생기면 profiles 행을 자동 생성.
-- 관리자가 inviteUserByEmail 호출 시 { data: { role: 'editor' } } 형태로 넘긴 값을 읽어 반영하고,
-- 없거나 잘못된 값이면 안전하게 'viewer'로 시작한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when requested_role in ('admin', 'editor', 'viewer') then requested_role else 'viewer' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- 본인 행은 항상 조회 가능, admin은 전체 조회 가능(계정관리 화면용)
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- 클라이언트에서 직접 insert/update/delete 하는 경로는 없음(가입 트리거 + 관리자 서비스롤 API로만 변경).


-- -------------------------------------------------------------------------
-- 2. classes — 반 목록 (학원 전체 공용, 익명도 읽을 수 있어야 학생 화면에서 버튼을 그림)
-- -------------------------------------------------------------------------
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('초', '중', '고')),
  grade smallint not null,
  name text not null check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (level, grade, name),
  check (
    (level = '초' and grade between 1 and 6) or
    (level in ('중', '고') and grade between 1 and 3)
  )
);

comment on table public.classes is
  '반 목록. level(초/중/고)+grade+name 조합으로 "고1 2반" 같은 학생 화면 라벨을 만든다(구 Apps Script 시스템과 동일한 표기).';

-- 반 개수 상한(300개) — CHECK로는 테이블 전체 행 수를 셀 수 없어 트리거로 강제
create or replace function public.enforce_classes_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.classes) >= 300 then
    raise exception '반은 최대 300개까지 등록할 수 있습니다.' using errcode = 'P0010';
  end if;
  return new;
end;
$$;

create trigger classes_limit_before_insert
  before insert on public.classes
  for each row execute function public.enforce_classes_limit();

alter table public.classes enable row level security;

-- 학생 제출 화면은 로그인하지 않은 익명 사용자이므로, 반 목록은 익명 포함 누구나 읽을 수 있어야 함.
-- (반 이름 자체는 민감정보가 아님 — 학생/성적 데이터가 아니라 단순 라벨 목록)
create policy "classes_select_anyone"
  on public.classes for select
  using (true);

create policy "classes_write_editor_or_admin"
  on public.classes for insert
  with check (public.is_editor_or_admin());

create policy "classes_update_editor_or_admin"
  on public.classes for update
  using (public.is_editor_or_admin())
  with check (public.is_editor_or_admin());

create policy "classes_delete_editor_or_admin"
  on public.classes for delete
  using (public.is_editor_or_admin());


-- -------------------------------------------------------------------------
-- 3. exams — 시험 목록
-- -------------------------------------------------------------------------
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 1 and 40),
  name text not null check (char_length(name) between 1 and 100),
  status text not null default '닫힘' check (status in ('열림', '닫힘')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.exams is '시험 목록. status=열림 일 때만 학생이 /s/[code] 에서 제출 가능.';

-- 정답이 하나도 없는 시험은 절대 "열림" 상태로 저장되지 않도록 DB 단에서도 한 번 더 막는다
-- (앱에서도 검사하지만, 이중 방어 원칙에 맞춰 트리거로도 강제)
create or replace function public.enforce_exam_open_requires_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = '열림' and not exists (select 1 from public.answer_key where exam_id = new.id) then
    raise exception '정답이 없는 시험은 열 수 없습니다.' using errcode = 'P0011';
  end if;
  return new;
end;
$$;

-- 시험 열기/닫기(= status 변경)는 관리자만 가능하도록 트리거로 강제.
-- (Supabase는 로그인 사용자를 전부 동일한 DB role 'authenticated' 로 취급하므로,
--  칼럼 단위 권한 분리는 GRANT가 아니라 트리거로 구현한다.)
create or replace function public.enforce_exam_status_change_admin_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception '시험 열기/닫기는 관리자만 할 수 있습니다.' using errcode = 'P0012';
  end if;
  return new;
end;
$$;

create trigger exams_before_update_status_guard
  before update on public.exams
  for each row execute function public.enforce_exam_status_change_admin_only();

-- answer_key 테이블 생성 후에 아래 트리거를 건다(테이블 순서상 뒤에서 추가 — 파일 하단 참고)

alter table public.exams enable row level security;

-- 익명(학생)은 "열림" 상태인 시험만 볼 수 있음 — /s/[code] 는 서버 컴포넌트가 서비스롤로 직접 조회하므로
-- 이 정책은 혹시 클라이언트에서 anon key로 직접 조회하는 경우에 대한 최소한의 안전장치.
create policy "exams_select_anon_open_only"
  on public.exams for select
  to anon
  using (status = '열림');

create policy "exams_select_staff_all"
  on public.exams for select
  to authenticated
  using (public.is_staff());

create policy "exams_insert_editor_or_admin"
  on public.exams for insert
  to authenticated
  with check (public.is_editor_or_admin());

create policy "exams_update_editor_or_admin"
  on public.exams for update
  to authenticated
  using (public.is_editor_or_admin())
  with check (public.is_editor_or_admin());

create policy "exams_delete_admin_only"
  on public.exams for delete
  to authenticated
  using (public.is_admin());


-- -------------------------------------------------------------------------
-- 4. answer_key — 시험별 정답
-- -------------------------------------------------------------------------
create table public.answer_key (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null check (char_length(item_label) between 1 and 20),
  sort_order int not null default 0,
  correct_answers text not null check (char_length(correct_answers) > 0),
  points numeric not null default 0 check (points >= 0),
  type text not null check (type in ('객관식', '주관식')),
  unique (exam_id, item_label)
);

comment on table public.answer_key is
  '문항별 정답. correct_answers 는 여러 정답을 "|" 로 구분(예: "3|삼"). type 은 채점 시점에 추론하지 않고 등록 시 그대로 저장.';

-- 이제 answer_key 가 생겼으니 exams 열기 검증 트리거를 등록
create trigger exams_before_update_open_requires_key
  before update on public.exams
  for each row
  when (new.status = '열림')
  execute function public.enforce_exam_open_requires_key();

alter table public.answer_key enable row level security;

-- 정답은 학생(anon)에게 절대 노출하지 않음 — 직원(admin/editor/viewer)만 조회
create policy "answer_key_select_staff_only"
  on public.answer_key for select
  to authenticated
  using (public.is_staff());

create policy "answer_key_write_editor_or_admin"
  on public.answer_key for insert
  to authenticated
  with check (public.is_editor_or_admin());

create policy "answer_key_update_editor_or_admin"
  on public.answer_key for update
  to authenticated
  using (public.is_editor_or_admin())
  with check (public.is_editor_or_admin());

create policy "answer_key_delete_editor_or_admin"
  on public.answer_key for delete
  to authenticated
  using (public.is_editor_or_admin());


-- -------------------------------------------------------------------------
-- 5. submissions — 학생 제출 (쓰기는 서버의 서비스롤 키로만; 클라이언트 직접 insert 불가)
-- -------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  class_label text not null check (char_length(class_label) between 1 and 40),
  student_name text not null check (char_length(student_name) between 1 and 20),
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (exam_id, class_label, student_name)
);

comment on table public.submissions is
  '학생 제출 원본 답안. class_label 은 서버가 반목록 검증 후 "고1 2반" 형태로 직접 구성(클라이언트 값 신뢰 안 함).';

alter table public.submissions enable row level security;

-- 직원만 조회 가능(익명 정책 없음 = 학생은 자기 제출을 DB에서 직접 읽을 수 없음, 화면에는 "제출 완료"만 표시)
create policy "submissions_select_staff_only"
  on public.submissions for select
  to authenticated
  using (public.is_staff());

-- insert 정책 없음 = 일반 클라이언트(anon/authenticated)는 절대 직접 쓸 수 없고,
-- 오직 서비스롤 키(RLS 우회)를 쓰는 /api/submit/[code] 서버 라우트만 기록할 수 있다.

create policy "submissions_delete_admin_only"
  on public.submissions for delete
  to authenticated
  using (public.is_admin());


-- -------------------------------------------------------------------------
-- 6. grading_results — 채점 결과(문항별 정오 + 총점)
-- -------------------------------------------------------------------------
create table public.grading_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  per_item jsonb not null,
  total_score numeric not null default 0,
  graded_at timestamptz not null default now()
);

comment on table public.grading_results is '제출 1건당 1행. submissions 가 삭제되면 같이 삭제됨(재제출 허용 흐름).';

alter table public.grading_results enable row level security;

create policy "grading_results_select_staff_only"
  on public.grading_results for select
  to authenticated
  using (public.is_staff());

-- insert 정책 없음 = submit_and_grade() 함수(SECURITY DEFINER)만 기록.


-- -------------------------------------------------------------------------
-- 7. submit_and_grade — 학생 제출을 원자적으로 기록하는 유일한 쓰기 경로
--    (반 존재 검증과 채점 계산 자체는 서버 API 라우트가 lib/grading.ts 로 미리 수행하고,
--     이 함수는 "제출 시점에 시험이 정말 열려 있는지"를 잠금과 함께 다시 확인 + 두 테이블 원자적 기록을 담당)
-- -------------------------------------------------------------------------
create or replace function public.submit_and_grade(
  p_exam_code text,
  p_class_label text,
  p_student_name text,
  p_answers jsonb,
  p_per_item jsonb,
  p_total_score numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_status text;
  v_submission_id uuid;
begin
  select id, status into v_exam_id, v_status
  from public.exams
  where code = p_exam_code
  for update;

  if v_exam_id is null then
    raise exception '존재하지 않는 시험입니다.' using errcode = 'P0020';
  end if;

  if v_status <> '열림' then
    raise exception '이 시험은 지금 제출을 받지 않습니다.' using errcode = 'P0021';
  end if;

  begin
    insert into public.submissions (exam_id, class_label, student_name, answers)
    values (v_exam_id, p_class_label, p_student_name, p_answers)
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

-- 익명 사용자가 이 함수를 "실행"할 권한은 필요 없음 — 실제 호출은 서버가 서비스롤 키로 하기 때문.
-- (서비스롤 키는 함수 실행 권한 검사 자체를 우회하므로 별도 GRANT가 필요 없다)

-- =========================================================================
-- 여기까지 실행하면 스키마 + RLS 준비 끝.
-- 다음으로 할 일: 이 프로젝트의 "첫 관리자" 1명을 수동으로 admin으로 올리는 것.
-- 아래는 예시(SQL 편집기에서 이메일만 본인 것으로 바꿔서 실행) — README.md 에도 동일 안내가 있음.
--
--   update public.profiles set role = 'admin' where email = 'your-email@example.com';
--
-- (먼저 Supabase Authentication 화면에서 본인 이메일로 초대/가입을 완료해서 auth.users, profiles 에
--  행이 생긴 뒤에 위 update 문을 실행해야 합니다.)
-- =========================================================================
