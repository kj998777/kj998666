-- 2026-09-29 원장님 요청: 과외선생님이 배정받은 검토 문항을 풀 수 있는 시간을 30분 → 1시간으로.
--
-- 배정 시간은 배정 함수 안에 적혀 있으므로 지금 쓰이는 두 함수를 그대로 다시 만들고 시간만 바꾼다.
--   · claim_verification_item_ex — 0022 본문 그대로, 사후검증 배정 시간만 1시간
--   · claim_next_review_item     — 0025 본문 그대로(신뢰도 '정지' 확인 포함), 새 문항 배정 시간만 1시간
-- 그리고 지금 이미 누가 풀고 있는(아직 만료 안 된) 배정도 30분 더 늘려 준다(새 규칙과 맞추기 위해).
-- 화면 문구(맡은 문제·사용법)는 앱 코드에서 함께 1시간으로 바꿨다.
--
-- 0026 다음에 실행.

-- -------------------------------------------------------------------------
-- 1. 사후검증 배정(0022 본문, 시간만 변경)
-- -------------------------------------------------------------------------
create or replace function public.claim_verification_item_ex(p_skipped boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_item_id uuid;
begin
  select r.id, r.item_explanation_id into v_review_id, v_item_id
  from public.tutor_item_reviews r
  join public.exams e on e.id = r.exam_id
  left join public.tutor_review_skips s
    on s.item_explanation_id = r.item_explanation_id and s.tutor_id = auth.uid()
  where r.kind = 'primary'
    and r.needs_verification
    and not r.verified
    and r.tutor_id <> auth.uid()
    and e.status = '검수대기'
    and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
    and ((s.tutor_id is not null) = p_skipped)
  order by s.skipped_at nulls first,
           e.is_jeju desc,
           case e.school_level when '고' then 0 when '중' then 1 else 2 end,
           r.created_at
  limit 1
  for update of r skip locked;

  if v_review_id is null then
    return null;
  end if;

  update public.tutor_item_reviews
    set verify_claimed_by = auth.uid(), verify_claim_expires_at = now() + interval '1 hour'
  where id = v_review_id;

  return v_item_id;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. 다음 문항 배정(0025 본문, 시간만 변경)
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
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 검토할 수 있습니다.' using errcode = 'P0030';
  end if;

  -- 0025: 신뢰도 '정지' 상태면 배정하지 않는다(원장님이 운영 현황에서 해제할 수 있음)
  if public.tutor_trust_level(auth.uid()) = 'paused' then
    raise exception '검토 배정이 잠시 멈춰 있습니다. 사후 검증에서 다른 선생님 답과 다른 경우가 여러 번 있어 원장님 확인을 기다리는 중입니다. 원장님께 문의해 주세요.' using errcode = 'P0060';
  end if;

  foreach v_pass in array array[false, true] loop
    -- 새 문항(v_pass=false: 안 넘긴 것, true: 넘긴 것 — 오래전에 넘긴 것부터)
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
             e.is_jeju desc,
             case e.school_level when '고' then 0 when '중' then 1 else 2 end,
             ie.updated_at
    limit 1
    for update of ie skip locked;

    if v_item_id is not null then
      update public.item_explanations
        set claimed_by = auth.uid(), claim_expires_at = now() + interval '1 hour'
      where id = v_item_id;
      return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
    end if;

    -- 사후검증 문항(같은 구분)
    v_item_id := public.claim_verification_item_ex(v_pass);
    if v_item_id is not null then
      return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'verify');
    end if;
  end loop;

  return null;
end;
$$;

grant execute on function public.claim_next_review_item() to authenticated;

-- -------------------------------------------------------------------------
-- 3. 지금 진행 중인 배정도 30분 연장
-- -------------------------------------------------------------------------
update public.item_explanations
  set claim_expires_at = claim_expires_at + interval '30 minutes'
where claimed_by is not null and claim_expires_at > now();

update public.tutor_item_reviews
  set verify_claim_expires_at = verify_claim_expires_at + interval '30 minutes'
where verify_claimed_by is not null and verify_claim_expires_at > now();
