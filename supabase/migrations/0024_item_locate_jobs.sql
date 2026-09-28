-- 2026-09-28 원장님 제보: 과외선생님 검토 화면에서 "그 문항만" 잘려 나오지 않고 문항이 있는 쪽 전체가 보인다.
--
-- 원인: 문항 영역 좌표(item_explanations.bbox_*, 0007)는 2026-09-27 저녁 이후 새로 AI 처리한 시험부터만
-- 저장된다. 그 전에 처리된 시험(지금 검토 대기 중인 시험 대부분)은 좌표가 없어서 화면이 쪽 전체를 보여 준다.
-- 또 새 시험도 AI가 좌표를 빼먹으면(추출 도구에서 bbox가 필수 칸이 아님) 같은 일이 생긴다.
--
-- 원장님 결정(2026-09-28): "AI로 좌표만 다시 찾기". 이 테이블은 시험 하나당 한 줄로, 좌표가 없는 문항들의
-- 영역만 AI에게 다시 물어보는 작업(lib/ai/locate.ts)의 진행 상태를 담는다. 검토현황 화면의 버튼이나
-- 크론(/api/ai/cron-tick)이 한 걸음씩 진행시킨다. 문항 해설·정답은 건드리지 않고 좌표와 쪽 번호만 채운다.
--
-- 0023 다음에 실행.

create table if not exists public.item_locate_jobs (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  stage text not null default 'submit' check (stage in ('submit', 'wait', 'done', 'error')),
  batch_id text,
  message text not null default '',
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_locate_jobs_stage_idx on public.item_locate_jobs (stage, updated_at);

alter table public.item_locate_jobs enable row level security;

drop policy if exists "item_locate_jobs_select_admin" on public.item_locate_jobs;
create policy "item_locate_jobs_select_admin"
  on public.item_locate_jobs for select to authenticated
  using (public.is_admin());

grant select on public.item_locate_jobs to authenticated;
-- 쓰기는 앱 서버(서비스롤)만.

-- -------------------------------------------------------------------------
-- 확인용: 검토 대기 문항 중 좌표가 없는 문항 수(시험별)
--   select e.name, count(*) filter (where ie.bbox_x0 is null) as 좌표없음, count(*) as 전체
--   from public.item_explanations ie join public.exams e on e.id = ie.exam_id
--   where e.status = '검수대기' and not ie.tutor_reviewed and not ie.review_confirmed
--   group by e.name order by 2 desc;
-- -------------------------------------------------------------------------
