-- 0042 과외선생님 맞춤 시험지(2026-09-30 원장님 요청 — 포인트 쓸 곳 늘리기)
--   과외선생님이 기출 스토어에 있는 시험(검수대기가 아니고 다운로드 가격이 정해진 시험)의 문항을 골라 새 시험지 + 정답·해설지를 만든다.
--   1) tutor_worksheets: 만든 시험지(문항 id 목록·쓴 포인트). 본인·관리자만 읽기, 쓰기는 아래 함수만.
--      tutor_worksheet_items: (선생님, 문항) — 정답 아는 문항 배정에서 빼는 데 쓴다.
--   2) tutor_create_worksheet(문항 id들, 제목): 1~30문항, 스토어 시험 문항만. 값 = 시험마다 min(그 시험 다운로드 가격, 문항 수÷2 올림),
--      이미 산 시험의 문항은 0. 포인트가 모자라면 거절. 포인트 기록 사유 worksheet_purchase.
--   3) claim_gold_item: 맞춤 시험지로 받은 문항은 그 선생님에게 "정답 아는 문항"으로 내지 않는다(답을 이미 봤으므로).
-- 여러 번 실행해도 안전하다. 0041 다음에 실행.

create table if not exists public.tutor_worksheets (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 60),
  item_ids uuid[] not null check (cardinality(item_ids) between 1 and 30),
  points_spent int not null default 0 check (points_spent >= 0),
  created_at timestamptz not null default now()
);
create index if not exists tutor_worksheets_tutor_idx on public.tutor_worksheets (tutor_id, created_at desc);
alter table public.tutor_worksheets enable row level security;
drop policy if exists "tutor_worksheets_select_own_or_admin" on public.tutor_worksheets;
create policy "tutor_worksheets_select_own_or_admin" on public.tutor_worksheets for select to authenticated
  using (tutor_id = auth.uid() or coalesce(public.is_admin(), false));
revoke all on public.tutor_worksheets from anon;
revoke insert, update, delete on public.tutor_worksheets from authenticated;
grant select on public.tutor_worksheets to authenticated;

create table if not exists public.tutor_worksheet_items (
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  item_explanation_id uuid not null references public.item_explanations (id) on delete cascade,
  first_at timestamptz not null default now(),
  primary key (tutor_id, item_explanation_id)
);
alter table public.tutor_worksheet_items enable row level security; -- 정책 없음: 아래 함수·서비스롤만
revoke all on public.tutor_worksheet_items from anon, authenticated;

alter table public.tutor_points_ledger drop constraint if exists tutor_points_ledger_reason_check;
alter table public.tutor_points_ledger add constraint tutor_points_ledger_reason_check
  check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment', 'dispute_reward', 'worksheet_purchase'));

-- 값 계산만(화면 미리보기용): 시험마다 min(다운로드 가격, 문항 수÷2 올림), 이미 산 시험은 0
create or replace function public.tutor_worksheet_cost(p_item_ids uuid[])
 returns int
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(sum(case when p.exam_id is not null then 0 else least(coalesce(e.tutor_download_cost, 0), ceil(x.n / 2.0)::int) end), 0)::int
  from (select ie.exam_id, count(*) as n from public.item_explanations ie where ie.id = any(p_item_ids) group by ie.exam_id) x
  join public.exams e on e.id = x.exam_id
  left join public.tutor_exam_purchases p on p.exam_id = x.exam_id and p.tutor_id = auth.uid();
$function$;
revoke execute on function public.tutor_worksheet_cost(uuid[]) from public, anon;
grant execute on function public.tutor_worksheet_cost(uuid[]) to authenticated;

create or replace function public.tutor_create_worksheet(p_item_ids uuid[], p_title text default '')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_item_ids), 0);
  v_ok int;
  v_cost int;
  v_bal int;
  v_id uuid;
begin
  if v_uid is null or not coalesce(public.is_tutor(), false) then
    raise exception '과외선생님 계정만 만들 수 있습니다.' using errcode = 'P0030';
  end if;
  if v_n < 1 or v_n > 30 then
    raise exception '문항은 1~30개까지 담을 수 있습니다.' using errcode = 'P0042';
  end if;
  if (select count(distinct x) from unnest(p_item_ids) x) <> v_n then
    raise exception '같은 문항이 두 번 들어 있습니다.' using errcode = 'P0042';
  end if;
  select count(*) into v_ok
  from public.item_explanations ie join public.exams e on e.id = ie.exam_id
  where ie.id = any(p_item_ids) and e.status <> '검수대기' and e.tutor_download_cost is not null;
  if v_ok <> v_n then
    raise exception '고를 수 없는 문항이 섞여 있습니다(기출 스토어에 없는 시험). 새로고침한 뒤 다시 담아 주세요.' using errcode = 'P0042';
  end if;
  v_cost := public.tutor_worksheet_cost(p_item_ids);
  select points_balance into v_bal from public.tutor_stats where tutor_id = v_uid for update;
  if coalesce(v_bal, 0) < v_cost then
    raise exception '포인트가 부족합니다(필요 %P, 보유 %P).', v_cost, coalesce(v_bal, 0) using errcode = 'P0040';
  end if;
  insert into public.tutor_worksheets (tutor_id, title, item_ids, points_spent)
  values (v_uid, left(btrim(coalesce(p_title, '')), 60), p_item_ids, v_cost)
  returning id into v_id;
  insert into public.tutor_worksheet_items (tutor_id, item_explanation_id)
  select v_uid, x from unnest(p_item_ids) x
  on conflict do nothing;
  if v_cost > 0 then
    update public.tutor_stats set points_balance = points_balance - v_cost where tutor_id = v_uid;
    insert into public.tutor_points_ledger (tutor_id, delta, reason) values (v_uid, -v_cost, 'worksheet_purchase');
  end if;
  return jsonb_build_object('id', v_id, 'cost', v_cost);
end;
$function$;
revoke execute on function public.tutor_create_worksheet(uuid[], text) from public, anon;
grant execute on function public.tutor_create_worksheet(uuid[], text) to authenticated;

-- 3)
create or replace function public.claim_gold_item()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
  v_exam uuid;
  v_label text;
begin
  -- 진짜 검토할 문항이 있을 때만 섞는다(없는데 정답 아는 문항만 주면 포인트만 나감)
  if not exists (
    select 1 from public.item_explanations ie join public.exams e on e.id = ie.exam_id
    where e.status = '검수대기' and not ie.tutor_reviewed and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
  ) and not exists (
    select 1 from public.tutor_item_reviews r join public.exams e on e.id = r.exam_id
    where r.kind = 'primary' and r.needs_verification and not r.verified and r.tutor_id <> auth.uid()
      and e.status = '검수대기' and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
      and coalesce(public.tutor_trust_level(auth.uid()), 'new') in ('ok', 'top')
  ) then
    return null;
  end if;
  if not public.gold_due(auth.uid()) then
    return null;
  end if;

  select ie.id, ie.exam_id, ie.item_label into v_item, v_exam, v_label
  from public.item_explanations ie
  join public.exams e on e.id = ie.exam_id
  where e.status in ('열림', '닫힘')
    and ie.review_confirmed
    and ie.review_confirm_source in ('admin', 'majority', 'auto_match')
    and exists (select 1 from public.answer_key k where k.exam_id = ie.exam_id and k.item_label = ie.item_label and k.correct_answers <> '')
    and not exists (select 1 from public.tutor_exam_purchases p where p.exam_id = ie.exam_id and p.tutor_id = auth.uid())
    and not exists (select 1 from public.tutor_gold_attempts g where g.item_explanation_id = ie.id and g.tutor_id = auth.uid())
    and not exists (select 1 from public.tutor_item_reviews r where r.item_explanation_id = ie.id and r.tutor_id = auth.uid())
    -- 0042: 맞춤 시험지로 정답·해설을 받은 문항은 그 선생님에게 정답 아는 문항으로 내지 않는다
    and not exists (select 1 from public.tutor_worksheet_items w where w.item_explanation_id = ie.id and w.tutor_id = auth.uid())
  order by random()
  limit 1;

  if v_item is null then
    return null;
  end if;
  insert into public.tutor_gold_attempts (tutor_id, item_explanation_id, exam_id, item_label)
  values (auth.uid(), v_item, v_exam, v_label);
  return v_item;
end;
$$;
revoke all on function public.claim_gold_item() from public, anon, authenticated;

-- 확인용(한 줄): 시험지_표=2, 사유_추가=true, 만들기_함수=2, 정답문항_제외=true
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tutor_worksheets', 'tutor_worksheet_items')) as 시험지_표,
  (position('worksheet_purchase' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tutor_points_ledger_reason_check')) > 0) as 사유_추가,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tutor_create_worksheet', 'tutor_worksheet_cost')) as 만들기_함수,
  (position('tutor_worksheet_items' in (select prosrc from pg_proc where proname = 'claim_gold_item')) > 0) as 정답문항_제외;
