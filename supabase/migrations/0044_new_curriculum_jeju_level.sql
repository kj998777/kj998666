-- 0044 검토 배정: 개정 교육과정 고1(공통수학1·2) 시험은 타 지역이어도 제주 시험과 같은 순위로(2026-10-01 원장님 요청)
--   공통수학1·2는 2022 개정 교육과정 과목이라 처음 시험이 2025년이고, 그 전 제주 기출이 없다.
--   그래서 다른 지역 학교의 공통수학 시험도 제주 학교 시험과 같은 칸("제주 급")으로 먼저 배정한다.
--   판단은 시험 이름에 "공통수학1/2"(공통 수학 2, 공통수학Ⅱ 등 띄어쓰기·로마 숫자 포함)가 들어 있는지로 한다.
--   바꾸는 곳: 다음 문항 받기(claim_next_review_item — 0043 본문)와 판정 문항 배정(claim_verification_item_ex — 0037 본문).
--   검토현황 화면의 순서도 같은 규칙(lib/tutor/priority.ts). 여러 번 실행해도 안전하다. 0043 다음에 실행.

create or replace function public.review_jeju_level(p_is_jeju boolean, p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_is_jeju, false) or coalesce(p_name, '') ~ '공통\s*수학\s*(1|2|Ⅰ|Ⅱ|I)';
$$;
grant execute on function public.review_jeju_level(boolean, text) to authenticated;

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
  if coalesce(public.tutor_trust_level(auth.uid()), 'new') not in ('ok', 'top') then
    return null;
  end if;
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
           r.tiebreak desc,
           public.review_jeju_level(e.is_jeju, e.name) desc,
           case e.school_level when '고' then 0 when '중' then 1 else 2 end,
           (select count(*) from public.item_explanations x
             where x.exam_id = r.exam_id and not x.tutor_reviewed and not x.review_confirmed),
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

revoke all on function public.claim_verification_item_ex(boolean) from public, anon, authenticated;

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
             public.review_jeju_level(e.is_jeju, e.name) desc,
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

-- 확인용(한 줄): 함수=true, 배정_반영=true, 판정_반영=true, 그리고 지금 "제주 급"으로 올라가는 타 지역 검토 대기 시험 수
select
  (public.review_jeju_level(false, '서울 휘문고 1학년 2025년 2학기 공통수학2 중간') and public.review_jeju_level(false, '공통 수학 Ⅱ') and not public.review_jeju_level(false, '수학 II 중간')) as 함수,
  (position('review_jeju_level' in (select prosrc from pg_proc where proname = 'claim_next_review_item')) > 0) as 배정_반영,
  (position('review_jeju_level' in (select prosrc from pg_proc where proname = 'claim_verification_item_ex')) > 0) as 판정_반영,
  (select count(*) from public.exams e where e.status = '검수대기' and not e.is_jeju and public.review_jeju_level(e.is_jeju, e.name)) as 올라간_타지역_시험;
