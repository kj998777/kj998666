-- 2026-09-28 원장님 요청 8·10: 정기 백업 보관함 + 과외선생님 신뢰도 관리.
--
-- 1. backups 버킷(비공개): 주 1회 자동 백업 파일(JSON.gz)을 저장한다(lib/backup.ts, 크론). 정책을 두지 않아
--    브라우저에서는 접근할 수 없고, 관리자 화면이 서비스롤로 목록·다운로드 링크를 만든다.
-- 2. 신뢰도: 사후 검증에서 다른 선생님 답과 달랐던 횟수(tutor_stats.reviews_flagged)로 단계를 정한다.
--      주의(watch)  = 불일치 2회 이상 → 이 선생님이 제출한 문항은 전부 사후 검증(원래는 15%만)
--      정지(paused) = 불일치 4회 이상이면서 검증받은 제출의 30% 이상이 불일치 → 새 문항 배정 멈춤
--      원장님이 운영 현황에서 직접 "정지"할 수도 있다(review_paused).
--    "신뢰도 초기화"는 그 시점까지의 불일치를 기준점(trust_baseline_flagged)으로 잡아 다시 0부터 센다
--    (불일치 기록 자체는 지우지 않음).
--
-- 0024 다음에 실행.

-- -------------------------------------------------------------------------
-- 1. 백업 버킷
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- 2. 신뢰도
-- -------------------------------------------------------------------------
alter table public.tutor_stats add column if not exists trust_baseline_flagged int not null default 0;
alter table public.tutor_stats add column if not exists review_paused boolean not null default false;

create or replace function public.tutor_trust_level(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_flagged int;
  v_base int;
  v_paused boolean;
  v_eff int;
  v_verified int;
begin
  -- 본인·관리자·서버(서비스롤, auth.uid() 없음)만 조회
  if auth.uid() is not null and p_tutor <> auth.uid() and not public.is_admin() then
    return null;
  end if;
  select reviews_flagged, trust_baseline_flagged, review_paused
    into v_flagged, v_base, v_paused
  from public.tutor_stats where tutor_id = p_tutor;
  if not found then
    return 'ok';
  end if;
  if v_paused then
    return 'paused';
  end if;
  v_eff := greatest(0, v_flagged - v_base);
  if v_eff >= 4 then
    select count(*) into v_verified
    from public.tutor_item_reviews
    where tutor_id = p_tutor and kind = 'primary' and verified;
    if v_eff >= ceil(0.3 * greatest(v_verified, 1)) then
      return 'paused';
    end if;
  end if;
  if v_eff >= 2 then
    return 'watch';
  end if;
  return 'ok';
end;
$$;

grant execute on function public.tutor_trust_level(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 3. 다음 문항 배정 — 0022 본문 + 정지 상태 확인
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
-- 4. 최초 제출 — 0018 본문 + 주의 상태면 전부 사후 검증
-- -------------------------------------------------------------------------
create or replace function public.submit_tutor_review(
  p_item_explanation_id uuid,
  p_answer_display text,
  p_solution text,
  p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_item_label text;
  v_exam_status text;
  v_reviewed boolean;
  v_confirmed boolean;
  v_claimed_by uuid;
  v_claim_expires timestamptz;
  v_review_id uuid;
  v_needs_verification boolean;
  v_points constant int := 1;
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 제출할 수 있습니다.' using errcode = 'P0030';
  end if;
  if char_length(coalesce(p_answer_display, '')) = 0 then
    raise exception '정답을 입력해 주세요.' using errcode = 'P0035';
  end if;
  if char_length(p_answer_display) > 500 or char_length(coalesce(p_solution, '')) > 4000 then
    raise exception '입력이 너무 깁니다.' using errcode = 'P0036';
  end if;
  if p_image_path is not null and char_length(p_image_path) > 500 then
    raise exception '사진 경로가 올바르지 않습니다.' using errcode = 'P0038';
  end if;

  select ie.exam_id, ie.item_label, e.status, ie.tutor_reviewed, ie.review_confirmed, ie.claimed_by, ie.claim_expires_at
    into v_exam_id, v_item_label, v_exam_status, v_reviewed, v_confirmed, v_claimed_by, v_claim_expires
  from public.item_explanations ie
  join public.exams e on e.id = ie.exam_id
  where ie.id = p_item_explanation_id
  for update of ie;

  if v_exam_id is null then
    raise exception '문항을 찾을 수 없습니다.' using errcode = 'P0031';
  end if;
  if v_reviewed then
    raise exception '이미 다른 분이 먼저 제출했습니다.' using errcode = 'P0033';
  end if;
  if v_confirmed then
    raise exception '이 문항은 이미 정답이 확정되어 검토가 필요 없습니다. 다른 문항을 받아 주세요.' using errcode = 'P0034';
  end if;
  if v_exam_status <> '검수대기' then
    raise exception '지금은 제출할 수 없는 문항입니다.' using errcode = 'P0032';
  end if;
  if v_claimed_by is distinct from auth.uid() or v_claim_expires < now() then
    raise exception '먼저 이 문항을 선점한 뒤 제출해 주세요(선점이 만료됐을 수 있습니다).' using errcode = 'P0037';
  end if;

  -- 0025: 신뢰도 '주의'(또는 정지) 과외선생님의 제출은 전부 사후 검증, 나머지는 15%
  v_needs_verification := random() < 0.15 or coalesce(public.tutor_trust_level(auth.uid()), 'ok') <> 'ok';

  update public.item_explanations
    set ai_answer_display = coalesce(ai_answer_display, answer_display),
        ai_solution = coalesce(ai_solution, solution),
        answer_display = p_answer_display,
        solution = p_solution,
        tutor_reviewed = true,
        claimed_by = null,
        claim_expires_at = null,
        updated_at = now()
  where id = p_item_explanation_id;

  insert into public.tutor_item_reviews
    (item_explanation_id, exam_id, item_label, tutor_id, kind, answer_display, solution, needs_verification, image_path)
  values
    (p_item_explanation_id, v_exam_id, v_item_label, auth.uid(), 'primary', p_answer_display, p_solution, v_needs_verification, p_image_path)
  returning id into v_review_id;

  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
  values (auth.uid(), v_points, 'review_primary', v_exam_id, v_item_label);

  update public.tutor_stats
    set points_balance = points_balance + v_points, reviews_submitted = reviews_submitted + 1
  where tutor_id = auth.uid();

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id, 'examOpened', false);
end;
$$;

grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 확인용:
--   select p.email, s.reviews_flagged, s.trust_baseline_flagged, s.review_paused, public.tutor_trust_level(s.tutor_id)
--   from public.tutor_stats s join public.profiles p on p.id = s.tutor_id;
-- -------------------------------------------------------------------------
