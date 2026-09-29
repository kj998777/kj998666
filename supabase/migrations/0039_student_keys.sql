-- 0039 — 학생별 누적 성적·단원 약점 분석 (2026-09-30 원장님 요청)
--
-- 학생 제출(submissions)에는 학생 표가 따로 없고 반 이름(class_label, 예: "고1 2반") + 이름만 있다.
-- 그래서 화면은 "반 + 이름"(과외 반은 "선생님 + 이름")을 한 학생으로 자동으로 묶는다(키 예: "반:고1 2반|김철수",
-- "과외:<선생님 id>|김철수"). 이 표는 그 자동 묶음에 대한 직원의 손질만 적는다:
--   merged_into — 다른 묶음과 같은 학생(예: 작년 "고1 2반 김철수" = 올해 "고2 3반 김철수", 이름 오타)이면 대표 키
--   hidden      — 목록에서 숨기기(시험용 제출 등)
--   memo        — 상담 메모(누적 보고서 PDF의 "선생님 의견"에 들어감)
-- 학생 이름이 들어가므로 읽기는 직원(관리자·편집자·뷰어)만, 쓰기는 편집자·관리자만. 과외선생님·학생은 못 본다.
-- 여러 번 실행해도 안전하다. 0038 다음에 실행.

create table if not exists public.student_keys (
  key text primary key check (char_length(key) between 3 and 200),
  merged_into text check (merged_into is null or (merged_into <> key and char_length(merged_into) between 3 and 200)),
  hidden boolean not null default false,
  memo text not null default '' check (char_length(memo) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists student_keys_merged_into_idx on public.student_keys (merged_into);

alter table public.student_keys enable row level security;
revoke all on public.student_keys from anon;
grant select, insert, update, delete on public.student_keys to authenticated;

drop policy if exists "student_keys_select_staff" on public.student_keys;
create policy "student_keys_select_staff" on public.student_keys for select to authenticated using (public.is_staff());
drop policy if exists "student_keys_insert_editor" on public.student_keys;
create policy "student_keys_insert_editor" on public.student_keys for insert to authenticated with check (public.is_editor_or_admin());
drop policy if exists "student_keys_update_editor" on public.student_keys;
create policy "student_keys_update_editor" on public.student_keys for update to authenticated
  using (public.is_editor_or_admin()) with check (public.is_editor_or_admin());
drop policy if exists "student_keys_delete_editor" on public.student_keys;
create policy "student_keys_delete_editor" on public.student_keys for delete to authenticated using (public.is_editor_or_admin());

-- 학생 목록·분석 화면이 시험별 제출을 빨리 읽도록
create index if not exists submissions_class_name_idx on public.submissions (class_label, student_name);

-- 확인용(1 / true)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'student_keys') as 학생_표,
  (select relrowsecurity from pg_class where relname = 'student_keys') as 보안_켜짐;
