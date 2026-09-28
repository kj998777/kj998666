-- 버그 수정(2026-09-28 원장님 제보): 과외선생님이 "포기하고 다른 문항 받기"를 계속 누르면 같은 시험
-- 안의 문항만 뱅뱅 돈다.
--
-- 원인: 0019에서 배정 순서를 "제주 학교 → 고등 → 중등 → (같으면) 오래 기다린 문항" 순으로 바꿨다.
-- 포기(release_review_claim, 0008)는 그 문항의 updated_at만 지금 시각으로 바꿔 "같은 순위 묶음의 맨
-- 뒤"로 보내는데, 순위 묶음(제주 여부·학교급)은 시험 단위로 정해지므로, 맨 위 묶음에 시험이 하나뿐이면
-- 그 시험 문항들 사이에서만 계속 돌고 다른 시험으로는 영영 넘어가지 않았다. 사후검증 문항은 포기해도
-- 순서 기준(created_at)이 바뀌지 않아 같은 문항이 바로 다시 나오는 문제도 있었다.
--
-- 고친 방식: 과외선생님마다 "넘긴 문항"을 기억한다(tutor_review_skips). 배정할 때
--   1) 이 선생님이 넘기지 않은 새 문항 (기존 우선순위: 제주 → 학교급 → 오래 기다린 순)
--   2) 이 선생님이 넘기지 않은 사후검증 문항 (같은 우선순위)
--   3) 넘긴 새 문항 — 가장 오래전에 넘긴 것부터 (다른 게 다 떨어졌을 때만 다시 보여 줌)
--   4) 넘긴 사후검증 문항 — 가장 오래전에 넘긴 것부터
-- 순서로 고른다. 그래서 포기하면 다음에는 반드시 아직 안 본 문항(다른 시험 포함)이 나오고, 볼 게
-- 없을 때만 넘겼던 문항이 다시 돌아온다. 넘긴 기록은 다른 선생님에게는 영향이 없다.
--
-- 0021 다음에 실행.

create table if not exists public.tutor_review_skips (
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  item_explanation_id uuid not null references public.item_explanations (id) on delete cascade,
  skipped_at timestamptz not null default now(),
  primary key (tutor_id, item_explanation_id)
);

-- 클라이언트가 직접 읽고 쓸 일은 없다(아래 security definer 함수만 사용). RLS를 켜고 정책을 두지 않는다.
alter table public.tutor_review_skips enable row level security;

-- -------------------------------------------------------------------------
-- 포기: 0008 본문 + 넘긴 기록 남기기(실제로 이 선생님이 잡고 있던 문항일 때만)
-- -------------------------------------------------------------------------
create or replace function public.release_review_claim(p_item_explanation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary int;
  v_verify int;
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 사용할 수 있습니다.' using errcode = 'P0030';
  end if;

  update public.item_explanations
    set claimed_by = null, claim_expires_at = null, updated_at = now()
  where id = p_item_explanation_id and claimed_by = auth.uid();
  get diagnostics v_primary = row_count;

  update public.tutor_item_reviews
    set verify_claimed_by = null, verify_claim_expires_at = null
  where item_explanation_id = p_item_explanation_id and kind = 'primary' and verify_claimed_by = auth.uid();
  get diagnostics v_verify = row_count;

  if v_primary + v_verify > 0 then
    insert into public.tutor_review_skips (tutor_id, item_explanation_id)
    values (auth.uid(), p_item_explanation_id)
    on conflict (tutor_id, item_explanation_id) do update set skipped_at = now();
  end if;
end;
$$;

grant execute on function public.release_review_claim(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 사후검증 배정 — 0019 본문 + "넘긴 문항 제외(p_skipped=false) / 넘긴 문항만(p_skipped=true)"
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
    set verify_claimed_by = auth.uid(), verify_claim_expires_at = now() + interval '30 minutes'
  where id = v_review_id;

  return v_item_id;
end;
$$;

-- 앱은 claim_next_review_item만 부른다(이 함수는 그 안에서만 쓰임).
revoke all on function public.claim_verification_item_ex(boolean) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 다음 문항 배정 — 위 1)~4) 순서
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
        set claimed_by = auth.uid(), claim_expires_at = now() + interval '30 minutes'
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
-- 확인용:
--   select count(*) from public.tutor_review_skips;   -- 포기를 누를 때마다 늘어남
-- -------------------------------------------------------------------------
