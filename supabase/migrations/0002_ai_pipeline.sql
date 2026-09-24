-- =========================================================================
-- 학원 시험관리 시스템 v2 — AI 자동 처리 파이프라인(문항 추출·풀이·검수·정정·
-- 디지털화·크레딧 장부) 스키마 + RLS + GRANT
--
-- 중요한 교훈(2026-09-24 세션에서 로그인이 계속 반복되던 진짜 원인이었음):
-- RLS 정책만으로는 부족하다. Postgres는 GRANT(테이블 접근 권한)를 RLS보다
-- *먼저* 검사하므로, authenticated/anon 롤에 GRANT를 빠뜨리면 RLS가 완벽해도
-- "permission denied for table ..." 로 전부 막힌다. 그래서 이 마이그레이션은
-- 새 테이블마다 CREATE POLICY 뒤에 반드시 GRANT 문도 함께 둔다.
--
-- 0001_init.sql에는 원래 GRANT 문이 아예 없었고(수동으로 Supabase SQL 편집기
-- 에서만 부여해 기록이 안 남아 있었다), 그 사실 자체가 새 학원 인스턴스를 다시
-- 세팅할 때 똑같은 버그를 반복시킬 위험이 있어 맨 앞에서 원래 6개 테이블의
-- GRANT도 함께(멱등하게) 다시 선언해 둔다.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. 0001_init.sql 테이블들의 GRANT를 마이그레이션 파일에도 남김(멱등)
-- -------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.exams to authenticated;
grant select, insert, update, delete on public.answer_key to authenticated;
grant select, insert, update, delete on public.submissions to authenticated;
grant select, insert, update, delete on public.grading_results to authenticated;

grant select on public.classes to anon;
grant select on public.exams to anon;

-- -------------------------------------------------------------------------
-- 1. exams.status 에 '검수대기' 추가 (AI 자동 처리 중인 시험의 임시 상태)
-- -------------------------------------------------------------------------
alter table public.exams drop constraint exams_status_check;
alter table public.exams add constraint exams_status_check
  check (status in ('열림', '닫힘', '검수대기'));

comment on column public.exams.status is
  '열림/닫힘/검수대기. 검수대기는 AI 자동 처리가 정답·해설을 만들었지만 선생님이 아직 확정하지 않은 상태(teacherAutoApprove 대응 확정 전까지는 학생 제출 불가).';

-- -------------------------------------------------------------------------
-- 2. exam_folders — 연도·학년·학기·구분(중간/기말/기타) 분류
--    (0001에서는 없던 열. exams 에 직접 열을 추가하는 편이 단순하다)
-- -------------------------------------------------------------------------
alter table public.exams add column folder_year text check (folder_year ~ '^20\d{2}$' or folder_year is null);
alter table public.exams add column folder_grade smallint check (folder_grade between 1 and 3 or folder_grade is null);
alter table public.exams add column folder_term smallint check (folder_term in (1, 2) or folder_term is null);
alter table public.exams add column folder_kind text check (folder_kind in ('중간', '기말', '기타') or folder_kind is null);

-- -------------------------------------------------------------------------
-- 3. item_explanations — 문항해설(영역·단원·난이도·풀이). 정답 자체는 answer_key에 그대로 둔다.
-- -------------------------------------------------------------------------
create table public.item_explanations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null check (char_length(item_label) between 1 and 20),
  area text not null default '',
  unit text not null default '',
  difficulty text not null default '중' check (difficulty in ('하', '중하', '중', '중상', '상')),
  difficulty_reason text not null default '',
  problem_statement text not null default '',
  answer_display text not null default '',
  solution text not null default '',
  points_assigned boolean not null default false,
  exam_error_suspected boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (exam_id, item_label)
);

comment on table public.item_explanations is
  '문항별 해설(영역/단원/난이도/문제 요약/정답표시/풀이). exam_error_suspected는 AI 해설 다시쓰기(v37) 때 붙는 출제오류 의심 표시.';

alter table public.item_explanations enable row level security;

create policy "item_explanations_select_staff"
  on public.item_explanations for select to authenticated using (public.is_staff());
create policy "item_explanations_write_editor_or_admin"
  on public.item_explanations for insert to authenticated with check (public.is_editor_or_admin());
create policy "item_explanations_update_editor_or_admin"
  on public.item_explanations for update to authenticated using (public.is_editor_or_admin()) with check (public.is_editor_or_admin());
create policy "item_explanations_delete_editor_or_admin"
  on public.item_explanations for delete to authenticated using (public.is_editor_or_admin());

grant select, insert, update, delete on public.item_explanations to authenticated;

-- -------------------------------------------------------------------------
-- 4. exam_notes — 선생님이 알아야 할 노트(시험지 오탈자·그림 해석 등)
-- -------------------------------------------------------------------------
create table public.exam_notes (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  sort_order int not null default 0,
  note text not null check (char_length(note) > 0),
  created_at timestamptz not null default now()
);

alter table public.exam_notes enable row level security;

create policy "exam_notes_select_staff"
  on public.exam_notes for select to authenticated using (public.is_staff());
create policy "exam_notes_write_editor_or_admin"
  on public.exam_notes for insert to authenticated with check (public.is_editor_or_admin());
create policy "exam_notes_delete_editor_or_admin"
  on public.exam_notes for delete to authenticated using (public.is_editor_or_admin());

grant select, insert, delete on public.exam_notes to authenticated;

-- -------------------------------------------------------------------------
-- 5. exam_corrections — 시험지 오류 정정(정오표). issue/fix는 학생에게 그대로 보이므로
--    정답·풀이를 암시하는 표현이 없는지 앱 레이어(lib/ai/fixSafe.ts)에서 반드시 걸러 저장한다.
-- -------------------------------------------------------------------------
create table public.exam_corrections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null check (char_length(item_label) between 1 and 20),
  issue text not null default '',
  fix text not null default '',
  teacher_note text not null default '',
  created_at timestamptz not null default now(),
  unique (exam_id, item_label)
);

comment on table public.exam_corrections is
  'issue/fix는 학생용 정오표에 실제로 인쇄되는 문구(정답·풀이 암시 금지). teacher_note는 선생님만 봄.';

alter table public.exam_corrections enable row level security;

create policy "exam_corrections_select_staff"
  on public.exam_corrections for select to authenticated using (public.is_staff());
create policy "exam_corrections_write_editor_or_admin"
  on public.exam_corrections for insert to authenticated with check (public.is_editor_or_admin());
create policy "exam_corrections_update_editor_or_admin"
  on public.exam_corrections for update to authenticated using (public.is_editor_or_admin()) with check (public.is_editor_or_admin());
create policy "exam_corrections_delete_editor_or_admin"
  on public.exam_corrections for delete to authenticated using (public.is_editor_or_admin());

grant select, insert, update, delete on public.exam_corrections to authenticated;

-- -------------------------------------------------------------------------
-- 6. exam_pdf_meta — 원본 시험지 PDF 메타(실제 파일은 Storage 버킷 exam-pdfs에 {exam_id}.pdf로 저장)
-- -------------------------------------------------------------------------
create table public.exam_pdf_meta (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  storage_path text not null,
  pages int,
  is_scanned boolean,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles (id) on delete set null
);

comment on column public.exam_pdf_meta.is_scanned is
  'null=판단 불가, true=글자 정보 없는 스캔본(디지털화 대상), false=일반 PDF. 브라우저의 pdf.js가 업로드 시 판별.';

alter table public.exam_pdf_meta enable row level security;

create policy "exam_pdf_meta_select_staff"
  on public.exam_pdf_meta for select to authenticated using (public.is_staff());
create policy "exam_pdf_meta_write_admin"
  on public.exam_pdf_meta for insert to authenticated with check (public.is_admin());
create policy "exam_pdf_meta_update_admin"
  on public.exam_pdf_meta for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "exam_pdf_meta_delete_admin"
  on public.exam_pdf_meta for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.exam_pdf_meta to authenticated;

-- -------------------------------------------------------------------------
-- 7. exam_jobs — AI 자동 처리(문항 추출→풀이→검수) 진행 상태.
--    Apps Script의 '자동처리' 시트 한 줄과 대응. state는 배치 id·사용량·문항목록 등 전체 작업 상태(JSON).
--    AI 처리는 비용이 드는 관리자 전용 기능이라 admin만 접근.
-- -------------------------------------------------------------------------
create table public.exam_jobs (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  stage text not null check (stage in (
    'upload', 'extract_submit', 'extract_wait', 'solve_submit', 'solve_wait', 'review', 'done', 'error'
  )),
  message text not null default '',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.exam_jobs enable row level security;

create policy "exam_jobs_all_admin"
  on public.exam_jobs for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.exam_jobs to authenticated;

-- -------------------------------------------------------------------------
-- 8. digitize_jobs / digitized_pages — 스캔 시험지 디지털화
-- -------------------------------------------------------------------------
create table public.digitize_jobs (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  stage text not null check (stage in ('dg_upload', 'dg_submit', 'dg_wait', 'dg_done', 'dg_error')),
  message text not null default '',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.digitized_pages (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  page_no int not null check (page_no > 0),
  data jsonb not null,
  unique (exam_id, page_no)
);

alter table public.digitize_jobs enable row level security;
alter table public.digitized_pages enable row level security;

create policy "digitize_jobs_all_admin"
  on public.digitize_jobs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "digitized_pages_all_admin"
  on public.digitized_pages for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.digitize_jobs to authenticated;
grant select, insert, update, delete on public.digitized_pages to authenticated;

-- -------------------------------------------------------------------------
-- 9. ai_settings — 모델·API 키 (관리자 전용, 단일 행)
-- -------------------------------------------------------------------------
create table public.ai_settings (
  id boolean primary key default true check (id),
  model text not null default 'claude-opus-5',
  api_key text,
  updated_at timestamptz not null default now()
);
insert into public.ai_settings (id) values (true);

alter table public.ai_settings enable row level security;

create policy "ai_settings_all_admin"
  on public.ai_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, update on public.ai_settings to authenticated;

-- -------------------------------------------------------------------------
-- 10. ai_usage — 크레딧 장부 + 잔액 추정 + 사용한도/크레딧 부족 경고 (단일 행)
-- -------------------------------------------------------------------------
create table public.ai_usage (
  id boolean primary key default true check (id),
  spent_usd numeric not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  since timestamptz not null default now(),
  balance_usd numeric,
  balance_recorded_at timestamptz,
  balance_spent_at_record numeric,
  low_alert_at timestamptz,
  low_alert_kind text check (low_alert_kind in ('credit', 'limit') or low_alert_kind is null),
  low_alert_message text
);
insert into public.ai_usage (id) values (true);

alter table public.ai_usage enable row level security;

create policy "ai_usage_all_admin"
  on public.ai_usage for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, update on public.ai_usage to authenticated;

-- =========================================================================
-- 11. Storage 버킷: 시험지 원본 PDF (비공개, 직원만 접근)
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('exam-pdfs', 'exam-pdfs', false)
on conflict (id) do nothing;

create policy "exam_pdfs_storage_select_staff"
  on storage.objects for select to authenticated
  using (bucket_id = 'exam-pdfs' and public.is_staff());

create policy "exam_pdfs_storage_write_admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exam-pdfs' and public.is_admin());

create policy "exam_pdfs_storage_update_admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'exam-pdfs' and public.is_admin())
  with check (bucket_id = 'exam-pdfs' and public.is_admin());

create policy "exam_pdfs_storage_delete_admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'exam-pdfs' and public.is_admin());

-- =========================================================================
-- 이 마이그레이션을 Supabase SQL 편집기에 붙여넣고 실행하세요.
-- 실행 후 확인할 것: select * from public.ai_settings; / select * from public.ai_usage;
-- 각각 한 행이 있어야 합니다.
-- =========================================================================
