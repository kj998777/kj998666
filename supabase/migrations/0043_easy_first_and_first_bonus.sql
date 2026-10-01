-- 0043 과외선생님 참여율 올리기(2026-10-01 원장님 요청)
--   실제 숫자(10/1): 과외선생님 7명 모두 로그인했지만 제출 7건, 포기 25건. 포기한 문항 25개 중 21개가 상·중상.
--   배정 순서가 "남은 문항이 적은 시험 먼저"라 어려운 문항만 몇 개 남은 시험이 앞에 와서, 처음 온 선생님이 고난도만 연달아 받았다.
--   1) 쉬운 문항부터: 제출 5개 전이거나, 바로 전에 어려운 문항(중상·상)을 풀었거나 포기했으면 하·중하·중 문항을 먼저 준다.
--      (빼는 게 아니라 순서만 — 쉬운 문항이 없으면 어려운 문항도 그대로 나온다.) 정답 아는 문항도 같은 규칙.
--   2) 처음 제출 보너스: 처음 3문항은 문항마다 +1P(포인트 기록 사유 first_bonus). 랭킹 점수에는 안 들어간다.
-- 여러 번 실행해도 안전하다. 0042 다음에 실행.

-- -------------------------------------------------------------------------
-- 0. 포인트 기록 사유에 first_bonus 추가
-- -------------------------------------------------------------------------
alter table public.tutor_points_ledger drop constraint if exists tutor_points_ledger_reason_check;
alter table public.tutor_points_ledger add constraint tutor_points_ledger_reason_check
  check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment', 'dispute_reward', 'worksheet_purchase', 'first_bonus'));

-- -------------------------------------------------------------------------
-- 1. 이 선생님에게 지금 쉬운 문항을 먼저 줄지
-- -------------------------------------------------------------------------
create or replace function public.tutor_prefers_easy(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.reviews_submitted from public.tutor_stats s where s.tutor_id = p_tutor), 0) < 5
      or coalesce((
        select x.hard_or_skip from (
          select r.created_at as t, ie.difficulty in ('중상', '상') as hard_or_skip
            from public.tutor_item_reviews r join public.item_explanations ie on ie.id = r.item_explanation_id
           where r.tutor_id = p_tutor
          union all
          select g.submitted_at, ie.difficulty in ('중상', '상')
            from public.tutor_gold_attempts g join public.item_explanations ie on ie.id = g.item_explanation_id
           where g.tutor_id = p_tutor and g.submitted_at is not null
          union all
          select k.skipped_at, true from public.tutor_review_skips k where k.tutor_id = p_tutor
          union all
          select g.claimed_at, true from public.tutor_gold_attempts g where g.tutor_id = p_tutor and g.released
        ) x
        order by x.t desc
        limit 1
      ), false);
$$;
revoke all on function public.tutor_prefers_easy(uuid) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. 적립 — 0037 본문 + 처음 3문항 보너스
-- -------------------------------------------------------------------------
create or replace function public.award_review_points(p_tutor uuid, p_base numeric, p_reason text, p_exam uuid, p_label text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text := public.tutor_trust_level(p_tutor);
  v_mult numeric := case v_level when 'top' then 1.5 when 'watch' then 0.5 else 1 end;
  v_carry numeric;
  v_done int;
  v_total numeric;
  v_points int;
begin
  select points_carry, reviews_submitted into v_carry, v_done from public.tutor_stats where tutor_id = p_tutor for update;
  v_total := p_base * v_mult + coalesce(v_carry, 0);
  v_points := floor(v_total);
  if v_points > 0 then
    insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
    values (p_tutor, v_points, p_reason, p_exam, p_label);
  end if;
  update public.tutor_stats
     set points_balance = points_balance + v_points,
         reviews_submitted = reviews_submitted + 1,
         points_carry = v_total - v_points
   where tutor_id = p_tutor;

  -- 0043: 처음 3문항(이번 제출 전 제출 수 0·1·2)은 +1P 더
  if p_reason = 'review_primary' and coalesce(v_done, 0) < 3 then
    insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
    values (p_tutor, 1, 'first_bonus', p_exam, p_label);
    update public.tutor_stats set points_balance = points_balance + 1 where tutor_id = p_tutor;
    v_points := v_points + 1;
  end if;
  return v_points;
end;
$$;
revoke all on function public.award_review_points(uuid, numeric, text, uuid, text) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. 정답 아는 문항 — 0042 본문 + 쉬운 문항 먼저
-- -------------------------------------------------------------------------
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
  v_easy boolean := public.tutor_prefers_easy(auth.uid());
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
  order by (v_easy and ie.difficulty in ('중상', '상')), random()
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

-- -------------------------------------------------------------------------
-- 4. 다음 문항 받기 — 0040 본문 + 쉬운 문항 먼저(넘긴 문항 순서 다음, 제주·학교급보다 앞)
-- -------------------------------------------------------------------------
create or replace function public.claim_next_review_item()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_pass boolean;
  v_easy boolean;
begin
  if not coalesce(public.is_tutor(), false) then
    raise exception '과외선생님 계정만 검토할 수 있습니다.' using errcode = 'P0030';
  end if;

  if public.tutor_trust_level(auth.uid()) = 'paused' then
    raise exception '검토 배정이 잠시 멈춰 있습니다. 최근 제출의 정답률이 낮아 원장님 확인을 기다리는 중입니다. 원장님께 문의해 주세요.' using errcode = 'P0060';
  end if;

  -- 0037: 정답 아는 문항(화면에는 새 문항과 똑같이 'primary'로 보낸다)
  v_item_id := public.claim_gold_item();
  if v_item_id is not null then
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
  end if;

  v_easy := public.tutor_prefers_easy(auth.uid());

  foreach v_pass in array array[false, true] loop
    -- 판정이 필요한 문항(다른 선생님 답과 비교) 먼저 — 검증됨·우수 선생님만 받는다
    v_item_id := public.claim_verification_item_ex(v_pass);
    if v_item_id is not null then
      return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'verify');
    end if;

    select ie.id into v_item_id
    from public.item_explanations ie
    join public.exams e on e.id = ie.exam_id
    left join public.tutor_review_skips s
      on s.item_explanation_id = ie.id and s.tutor_id = auth.uid()
    where e.status = '검수대기'
      and not ie.tutor_reviewed
      and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
      and ((s.tutor_id is not null) = v_pass)
    order by s.skipped_at nulls first,
             (v_easy and ie.difficulty in ('중상', '상')),
             e.is_jeju desc,
             case e.school_level when '고' then 0 when '중' then 1 else 2 end,
             (select count(*) from public.item_explanations x
               where x.exam_id = ie.exam_id and not x.tutor_reviewed and not x.review_confirmed),
             ie.updated_at
    limit 1
    for update of ie skip locked;

    if v_item_id is not null then
      update public.item_explanations
        set claimed_by = auth.uid(), claim_expires_at = now() + interval '1 hour'
      where id = v_item_id;
      return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
    end if;
  end loop;

  return null;
end;
$$;
revoke execute on function public.claim_next_review_item() from public, anon;
grant execute on function public.claim_next_review_item() to authenticated;

-- 확인용(한 줄): 사유_추가=true, 쉬운문항_함수=1, 보너스=true, 배정_쉬운먼저=true, 정답문항_쉬운먼저=true
select
  (position('first_bonus' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tutor_points_ledger_reason_check')) > 0) as 사유_추가,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tutor_prefers_easy') as 쉬운문항_함수,
  (position('first_bonus' in (select prosrc from pg_proc where proname = 'award_review_points')) > 0) as 보너스,
  (position('v_easy' in (select prosrc from pg_proc where proname = 'claim_next_review_item')) > 0) as 배정_쉬운먼저,
  (position('v_easy' in (select prosrc from pg_proc where proname = 'claim_gold_item')) > 0) as 정답문항_쉬운먼저;
