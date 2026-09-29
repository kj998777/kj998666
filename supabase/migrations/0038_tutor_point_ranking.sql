-- 0038 — 과외선생님 포인트 랭킹 (2026-09-30 원장님 요청)
--
-- 랭킹이 도입된 뒤(이 SQL을 실행한 시각부터) **문제를 풀어서 얻은 포인트만** 센다 — 검토 제출(review_primary)과
-- 판정·사후 검증 제출(review_verify, 정답 아는 문항 포함). 보유 포인트와는 별개라, 환영 포인트·관리자 지급·이의제기 보상은
-- 들어가지 않고 기출 구매로 쓴 포인트도 빠지지 않는다.
-- 기간: all = 도입 이후 전체, month = 이번 달(한국 시각). 같은 점수는 같은 순위.
-- 과외선생님에게는 다른 사람 이름을 "31기 김○○"처럼 가려서 보여 주고(본인은 그대로), 관리자에게는 그대로 보여 준다.
-- 여러 번 실행해도 안전하다(도입 시각은 처음 실행한 시각으로 남는다). 0037 다음에 실행.

create table if not exists public.tutor_ranking_settings (
  id boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
insert into public.tutor_ranking_settings (id) values (true) on conflict (id) do nothing;
alter table public.tutor_ranking_settings enable row level security;
drop policy if exists "tutor_ranking_settings_select" on public.tutor_ranking_settings;
create policy "tutor_ranking_settings_select" on public.tutor_ranking_settings for select to authenticated using (true);
grant select on public.tutor_ranking_settings to authenticated;

create index if not exists tutor_points_ledger_reason_created_idx on public.tutor_points_ledger (reason, created_at);

create or replace function public.tutor_point_ranking(p_period text default 'all', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_from timestamptz;
  v_admin boolean := coalesce(public.is_admin(), false);
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_mine jsonb;
begin
  if not (v_admin or public.is_tutor() or v_me is null) then
    return null;
  end if;
  select started_at into v_start from public.tutor_ranking_settings where id;
  v_start := coalesce(v_start, now());
  if p_period = 'month' then
    v_from := greatest(v_start, (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul');
  else
    v_from := v_start;
  end if;

  with pts as (
    select l.tutor_id, sum(l.delta)::int as points
    from public.tutor_points_ledger l
    where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from
    group by l.tutor_id
  ),
  ranked as (
    select p.tutor_id, p.points, rank() over (order by p.points desc) as rnk,
           pr.display_name, pr.cohort, pr.department, pr.email
    from pts p join public.profiles pr on pr.id = p.tutor_id
    where pr.role = 'tutor'
  ),
  labeled as (
    select r.*,
      case
        when v_admin or r.tutor_id = v_me then
          trim(concat_ws(' ', nullif(case when r.department is not null and r.department <> '의대' then r.department end, ''), r.cohort, coalesce(nullif(r.display_name, ''), case when v_admin then r.email end, '선생님')))
        else
          trim(concat_ws(' ', r.cohort,
            case when coalesce(r.display_name, '') = '' then '선생님'
                 else left(r.display_name, 1) || repeat('○', greatest(char_length(r.display_name) - 1, 1)) end))
      end as label
    from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', rnk, 'points', points, 'label', label, 'me', tutor_id = v_me) order by rnk, label), '[]'::jsonb)
    into v_rows
  from (select * from labeled order by rnk, label limit greatest(1, least(p_limit, 200))) x;

  select jsonb_build_object('rank', rnk, 'points', points)
    into v_mine
  from (
    select p.tutor_id, p.points, rank() over (order by p.points desc) as rnk
    from (select l.tutor_id, sum(l.delta)::int as points from public.tutor_points_ledger l
           where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from
           group by l.tutor_id) p
    join public.profiles pr on pr.id = p.tutor_id and pr.role = 'tutor'
  ) z where z.tutor_id = v_me;

  return jsonb_build_object('startedAt', v_start, 'from', v_from, 'rows', v_rows, 'mine', v_mine,
    'total', (select count(distinct l.tutor_id) from public.tutor_points_ledger l join public.profiles pr on pr.id = l.tutor_id and pr.role = 'tutor'
               where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from));
end;
$$;
grant execute on function public.tutor_point_ranking(text, int) to authenticated;

-- 확인용: 도입 시각과 지금 순위(처음엔 비어 있음)
select (select started_at from public.tutor_ranking_settings) as 랭킹_시작, public.tutor_point_ranking('all', 10) as 랭킹;
