-- 0030 — 과외선생님 검토 배정 순서에 "남은 검토대기 문항이 적은 시험 먼저"를 3순위로 넣는다 (2026-09-29 원장님 요청)
--
-- 새 순서(위가 먼저):
--   1. 내가 넘기지 않은 문항 (넘긴 문항은 맨 뒤, 그중 오래전에 넘긴 것부터)
--   2. 제주 학교 시험
--   3. 남은 검토대기 문항(아직 아무도 제출하지 않았고 확정도 안 된 문항) 수가 적은 시험  ← 새로 추가
--   4. 고등학교 → 중학교 → 미정
--   5. 오래된 문항(사후 검증은 오래된 제출)부터
-- 거의 끝난 시험부터 마무리되니 시험이 더 빨리 확정·자동으로 열린다.
-- 새 문항(claim_next_review_item)과 사후 검증(claim_verification_item_ex) 모두 같은 기준. 0027 본문에서 정렬만 바꿨다.
-- 여러 번 실행해도 안전하다.

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
           -- 0030: 남은 검토대기 문항이 적은 시험 먼저(거의 끝난 시험을 먼저 마무리)
           (select count(*) from public.item_explanations x
             where x.exam_id = r.exam_id and not x.tutor_reviewed and not x.review_confirmed),
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
             -- 0030: 남은 검토대기 문항이 적은 시험 먼저(거의 끝난 시험을 먼저 마무리)
             (select count(*) from public.item_explanations x
               where x.exam_id = ie.exam_id and not x.tutor_reviewed and not x.review_confirmed),
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

-- 확인용: 지금 배정 순서(넘긴 문항 구분 제외 — 과외선생님마다 다름)
select e.name as 시험,
       case when e.is_jeju then '예' else '아니오' end as 제주,
       count(*) filter (where not ie.tutor_reviewed and not ie.review_confirmed) as 남은_검토대기,
       coalesce(e.school_level, '-') as 학교급
from public.exams e
join public.item_explanations ie on ie.exam_id = e.id
where e.status = '검수대기'
group by e.id, e.name, e.is_jeju, e.school_level
having count(*) filter (where not ie.tutor_reviewed and not ie.review_confirmed) > 0
order by e.is_jeju desc,
         count(*) filter (where not ie.tutor_reviewed and not ie.review_confirmed),
         case e.school_level when '고' then 0 when '중' then 1 else 2 end,
         e.name;
