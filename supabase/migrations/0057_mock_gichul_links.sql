-- 0057 (2026-10-12 원장님 "사설모의고사 문제랑 기출문제랑 — 어떤 기출 아이디어를 출제한 것인지" → "4점 문항만, 사이트에 등록")
--   mock_gichul_links: 고3 사설 모의고사 문항 ↔ 같은 아이디어의 평가원 기출
--   한 문항에 기출 여러 개(rank 1이 가장 가까운 짝). source = "2026학년도 수능 공통 21번", idea = 공통 아이디어 한 줄,
--   image = 기출 문제 그림(PNG data URL, 원본 문제지에서 오려 붙임 — 작게 줄여 저장).
--   시험 화면(원장님 대응표·수정)과 보고서(문항표에 출처, 틀린·빈 문항에 기출 그림)가 쓴다 — lib/exams/gichulLinks.ts
--   쓰기는 서버 액션이 편집자 확인 뒤 서비스롤로(app/(staff)/exams/mock-actions.ts). 읽기는 직원.
create table if not exists public.mock_gichul_links (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  item_label text not null,
  rank smallint not null default 1,
  source text not null check (char_length(source) between 1 and 120),
  idea text not null default '' check (char_length(idea) <= 300),
  image text check (image is null or (image like 'data:image/%' and char_length(image) <= 700000)),
  created_at timestamptz not null default now()
);
create index if not exists mock_gichul_links_exam_idx on public.mock_gichul_links (exam_id, item_label, rank);

alter table public.mock_gichul_links enable row level security;
drop policy if exists "mock_gichul_links_select_staff" on public.mock_gichul_links;
create policy "mock_gichul_links_select_staff" on public.mock_gichul_links for select to authenticated
  using (coalesce(public.is_staff(), false));
grant select on public.mock_gichul_links to authenticated;

comment on table public.mock_gichul_links is '고3 사설 모의고사 문항 ↔ 기출 아이디어 연결(출처·공통 아이디어·기출 그림) — lib/exams/gichulLinks.ts';

-- 확인
select count(*) as 새_표 from information_schema.tables where table_schema = 'public' and table_name = 'mock_gichul_links';
