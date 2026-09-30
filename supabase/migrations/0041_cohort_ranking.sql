-- 0041 기수별 랭킹 + 랭킹 이름의 학번 가리기(2026-09-30)
--   1) tutor_cohort_group(과, 기수/학번): 사람을 묶는 이름. 의대는 "30기", 다른 과는 "수의대 21학번"처럼 입학 연도 두 자리만 쓴다
--      ("2021123456"·"2021학번"·"21학번" → "21학번"). 기수·학번이 없으면 "기수 미입력".
--   2) tutor_cohort_ranking(기간): 기수(과+기수)별로 "문제를 풀어 얻은 포인트"(0038과 같은 기준)를 합쳐 순위. 인원·1인 평균도 함께.
--      과외선생님·관리자·서버(서비스롤)만 부를 수 있다(0040과 같은 검사).
--   3) tutor_point_ranking: 다른 선생님 이름 앞에 붙는 기수를 1)의 묶음 이름으로 바꾼다 — 전에는 학번을 전체로 적은 선생님이면
--      다른 선생님 화면 랭킹에 그 학번이 그대로 보였다. 본인·관리자 화면은 그대로.
-- 여러 번 실행해도 안전하다. 0040 다음에 실행.

-- 1)
create or replace function public.tutor_cohort_group(p_department text, p_cohort text)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  d text := case when coalesce(btrim(p_department), '') in ('', '의대') then '' else btrim(p_department) end;
  c text := regexp_replace(coalesce(p_cohort, ''), '\s', '', 'g');
  m text[];
begin
  if c = '' then
    return trim(concat_ws(' ', nullif(d, ''), '기수 미입력'));
  end if;
  if c ~ '^\d+기$' then
    null; -- 의대 기수 그대로
  elsif d = '' and c ~ '^\d{1,3}$' then
    c := c || '기'; -- 의대는 숫자만 적었으면 기수("30" → "30기")
  elsif c ~ '^(19|20)\d{2}(학번)?$' then
    c := substr(c, 3, 2) || '학번';
  elsif c ~ '^\d{2}(학번)?$' then
    c := substr(c, 1, 2) || '학번';
  elsif c ~ '^(19|20)\d{6,}$' then
    c := substr(c, 3, 2) || '학번'; -- 2021123456 → 21학번
  elsif c ~ '^\d{5,}$' then
    c := substr(c, 1, 2) || '학번'; -- 21123456 → 21학번
  else
    m := regexp_match(c, '^(\d+)');
    if m is not null and char_length(m[1]) >= 5 then
      c := substr(m[1], case when m[1] ~ '^(19|20)' then 3 else 1 end, 2) || '학번';
    else
      c := left(c, 10);
    end if;
  end if;
  return trim(concat_ws(' ', nullif(d, ''), c));
end;
$function$;
grant execute on function public.tutor_cohort_group(text, text) to authenticated;

-- 2)
create or replace function public.tutor_cohort_ranking(p_period text default 'all')
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_start timestamptz;
  v_from timestamptz;
  v_admin boolean := coalesce(public.is_admin(), false) or coalesce(auth.role(), '') = 'service_role';
  v_me uuid := auth.uid();
  v_my_group text;
  v_rows jsonb;
begin
  if not (v_admin or coalesce(public.is_tutor(), false) or (v_me is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))) then
    return null;
  end if;
  select started_at into v_start from public.tutor_ranking_settings where id;
  v_start := coalesce(v_start, now());
  if p_period = 'month' then
    v_from := greatest(v_start, (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul');
  else
    v_from := v_start;
  end if;
  select public.tutor_cohort_group(department, cohort) into v_my_group from public.profiles where id = v_me and role = 'tutor';

  with pts as (
    select l.tutor_id, sum(l.delta)::int as points
    from public.tutor_points_ledger l
    where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from
    group by l.tutor_id
  ),
  grp as (
    select public.tutor_cohort_group(pr.department, pr.cohort) as label, sum(p.points)::int as points, count(*)::int as members
    from pts p join public.profiles pr on pr.id = p.tutor_id
    where pr.role = 'tutor'
    group by 1
  ),
  ranked as (
    select g.*, rank() over (order by g.points desc) as rnk from grp g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rnk, 'label', label, 'points', points, 'members', members,
           'avg', round(points::numeric / greatest(members, 1)), 'mine', label = v_my_group
         ) order by rnk, label), '[]'::jsonb)
    into v_rows
  from ranked;

  return jsonb_build_object('startedAt', v_start, 'from', v_from, 'rows', v_rows, 'myGroup', v_my_group);
end;
$function$;
revoke execute on function public.tutor_cohort_ranking(text) from public, anon;
grant execute on function public.tutor_cohort_ranking(text) to authenticated;

-- 3)
CREATE OR REPLACE FUNCTION public.tutor_point_ranking(p_period text DEFAULT 'all'::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_from timestamptz;
  -- 0040: 관리자 화면(운영 현황)은 서비스롤로 부르므로 그때도 이름을 그대로
  v_admin boolean := coalesce(public.is_admin(), false) or coalesce(auth.role(), '') = 'service_role';
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_mine jsonb;
begin
  -- 0040: 로그인 안 한 사람(anon)은 못 본다(전에는 auth.uid()가 없으면 통과)
  -- (is_tutor()는 비로그인이면 NULL이라 coalesce 필요 — 전에는 NULL 때문에 이 검사가 통째로 통과됐다)
  if not (v_admin or coalesce(public.is_tutor(), false) or (v_me is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))) then
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
          -- 0041: 다른 선생님에게는 기수·학번을 묶음 이름으로만("2021123456" 같은 학번 전체가 보이지 않게, 과도 함께)
          trim(concat_ws(' ', public.tutor_cohort_group(r.department, r.cohort),
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
$function$;
revoke execute on function public.tutor_point_ranking(text, integer) from public, anon;
grant execute on function public.tutor_point_ranking(text, integer) to authenticated;

-- 확인용(한 줄): 기수묶음=21학번 · 30기 · 수의대 21학번, 기수별_함수=1, 익명_막음=true, 랭킹_가림=true
select
  public.tutor_cohort_group('의대', '2021123456') as 기수묶음_학번,
  public.tutor_cohort_group(null, '30기') as 기수묶음_의대,
  public.tutor_cohort_group('수의대', '2021학번') as 기수묶음_수의대,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tutor_cohort_ranking') as 기수별_함수,
  (not has_function_privilege('anon', 'public.tutor_cohort_ranking(text)', 'execute')) as 익명_막음,
  (position('tutor_cohort_group(r.department' in (select prosrc from pg_proc where proname = 'tutor_point_ranking')) > 0) as 랭킹_가림;
