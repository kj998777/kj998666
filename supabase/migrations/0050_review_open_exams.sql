-- 0050 (2026-10-05 원장님 "2번" — 시험은 열어 두고 검토도 계속):
--   오늘 정답 점검에서 AI가 "확신"으로 자동 확정한 문항은 시험마다 30~50%가 틀렸다(프로젝트 문서
--   claude/answer-key-audit-2026-10.md). 그런데 검토 대기 문항이 검수대기 시험에만 생기다 보니, 그런 문항이 확정된 채
--   시험이 열려 과외선생님 검토 대상이 7문항까지 줄었다.
--   바꾸는 것:
--   1) 검토 대상 = 정답이 확정 안 된 문항이면 시험 상태와 상관없이(검수대기·열림·닫힘). 열린 시험은 학생이 계속 내고,
--      과외선생님 답으로 정답표가 바뀌면 지금처럼 다시 채점된다(lib/review/majority.ts regradeIfChanged,
--      검토현황 확정도 regradeExam). 단, 열린·닫힌 시험에서 "시험지 오류 의심" 문항은 원장님 몫이라 빼고,
--      그 시험을 이미 산(정답·해설을 가진) 선생님과 맞춤 시험지로 그 문항 해설을 받은 선생님에게는 내지 않는다.
--   2) 앞으로 AI 자동 확정은 "시험지에 인쇄된 정답과 AI 답이 같을 때"만(앱 lib/ai/pipeline.ts·combine.ts).
--   3) 1회: AI 확신으로 확정돼 있던 문항을 검토 대기로 되돌리고, 검수대기 시험 6개를 연다.
--   바꾸는 함수: review_item_open(새 도우미), claim_next_review_item·claim_verification_item_ex(0044 본문),
--   claim_gold_item(0043 본문), submit_tutor_review(0040 본문). 여러 번 실행해도 안전하다. 0049 다음에 실행.

-- -------------------------------------------------------------------------
-- 0. 도우미: 이 시험 상태·문항이면 과외선생님 검토 대상이 될 수 있는가
-- -------------------------------------------------------------------------
create or replace function public.review_item_open(p_status text, p_error_suspected boolean)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status = '검수대기' or (p_status in ('열림', '닫힘') and not coalesce(p_error_suspected, false));
$$;
grant execute on function public.review_item_open(text, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 1. 판정 문항 배정 — 0044 본문, 시험 상태 조건만 바꿈
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
  if coalesce(public.tutor_trust_level(auth.uid()), 'new') not in ('ok', 'top') then
    return null;
  end if;
  select r.id, r.item_explanation_id into v_review_id, v_item_id
  from public.tutor_item_reviews r
  join public.exams e on e.id = r.exam_id
  join public.item_explanations ie on ie.id = r.item_explanation_id
  left join public.tutor_review_skips s
    on s.item_explanation_id = r.item_explanation_id and s.tutor_id = auth.uid()
  where r.kind = 'primary'
    and r.needs_verification
    and not r.verified
    and r.tutor_id <> auth.uid()
    and public.review_item_open(e.status, ie.exam_error_suspected)
    and (e.status = '검수대기' or not exists (select 1 from public.tutor_exam_purchases p where p.exam_id = r.exam_id and p.tutor_id = auth.uid()))
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

-- -------------------------------------------------------------------------
-- 2. 정답 아는 문항 — 0043 본문, "진짜 검토할 문항이 있는가" 조건만 바꿈
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
    where public.review_item_open(e.status, ie.exam_error_suspected) and not ie.tutor_reviewed and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
  ) and not exists (
    select 1 from public.tutor_item_reviews r join public.exams e on e.id = r.exam_id
    join public.item_explanations ie on ie.id = r.item_explanation_id
    where r.kind = 'primary' and r.needs_verification and not r.verified and r.tutor_id <> auth.uid()
      and public.review_item_open(e.status, ie.exam_error_suspected)
      and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
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
-- 3. 다음 문항 받기 — 0044 본문, 시험 상태 조건 + 산 시험·맞춤 시험지 문항 빼기
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
    where public.review_item_open(e.status, ie.exam_error_suspected)
      and not ie.tutor_reviewed
      and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
      and ((s.tutor_id is not null) = v_pass)
      -- 0050: 열린 시험 문항은 그 시험을 산 선생님·맞춤 시험지로 해설을 받은 선생님에게 내지 않는다
      and (e.status = '검수대기' or (
            not exists (select 1 from public.tutor_exam_purchases p where p.exam_id = ie.exam_id and p.tutor_id = auth.uid())
        and not exists (select 1 from public.tutor_worksheet_items w where w.item_explanation_id = ie.id and w.tutor_id = auth.uid())))
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

-- -------------------------------------------------------------------------
-- 4. 검토 제출 — 0040 본문, 시험 상태 검사만 바꿈
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_tutor_review(p_item_explanation_id uuid, p_answer_display text, p_solution text, p_image_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exam_id uuid;
  v_item_label text;
  v_exam_status text;
  v_error_suspected boolean;
  v_reviewed boolean;
  v_confirmed boolean;
  v_claimed_by uuid;
  v_claim_expires timestamptz;
  v_review_id uuid;
  v_needs_verification boolean;
  v_level text;
  v_points int;
begin
  if not coalesce(public.is_tutor(), false) then
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

  select ie.exam_id, ie.item_label, e.status, ie.exam_error_suspected, ie.tutor_reviewed, ie.review_confirmed, ie.claimed_by, ie.claim_expires_at
    into v_exam_id, v_item_label, v_exam_status, v_error_suspected, v_reviewed, v_confirmed, v_claimed_by, v_claim_expires
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
  if not public.review_item_open(v_exam_status, v_error_suspected) then
    raise exception '지금은 제출할 수 없는 문항입니다.' using errcode = 'P0032';
  end if;
  if v_claimed_by is distinct from auth.uid() or v_claim_expires < now() then
    raise exception '먼저 이 문항을 선점한 뒤 제출해 주세요(선점이 만료됐을 수 있습니다).' using errcode = 'P0037';
  end if;

  -- 0037: 등급별 사후 검증 — 신규·주의(정지) 100%, 검증됨 10%, 우수 5%. (AI와 다르면 앱 서버가 다수결 판정으로 돌린다)
  v_level := coalesce(public.tutor_trust_level(auth.uid()), 'ok');
  v_needs_verification := case v_level
    when 'top' then random() < 0.05
    when 'ok' then random() < 0.10
    else true end;

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

  v_points := public.award_review_points(auth.uid(), public.review_points_for_item(p_item_explanation_id), 'review_primary', v_exam_id, v_item_label);

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id, 'examOpened', false);
end;
$function$;
revoke execute on function public.submit_tutor_review(uuid, text, text, text) from public, anon;
grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 5. 1회 정리 (2026-10-05): AI 확신으로 확정된 문항 → 검토 대기, 검수대기 시험 6개 열기
-- -------------------------------------------------------------------------
update public.item_explanations
   set review_confirmed = false, review_confirm_source = null, review_confirmed_at = null
 where review_confirm_source = 'ai_confident' and review_confirmed;

update public.exam_jobs j
   set stage = 'done', message = '원장님 결정(2026-10-05): 시험은 열고, AI가 확정했던 문항은 과외선생님 검토를 계속 받습니다.', updated_at = now()
  from public.exams e
 where e.id = j.exam_id and e.status = '검수대기' and j.stage = 'review';

update public.exams set status = '열림' where status = '검수대기';

-- 확인용(한 줄): 함수_반영=true, AI확신_남음=0, 검수대기=0, 검토_대상=(열린 시험 포함 미확정 문항 수)
select
  (position('review_item_open' in (select prosrc from pg_proc where proname = 'claim_next_review_item')) > 0) as 함수_반영,
  (select count(*) from public.item_explanations where review_confirm_source = 'ai_confident' and review_confirmed) as AI확신_남음,
  (select count(*) from public.exams where status = '검수대기') as 검수대기,
  (select count(*) from public.item_explanations ie join public.exams e on e.id = ie.exam_id
    where public.review_item_open(e.status, ie.exam_error_suspected) and not ie.tutor_reviewed and not ie.review_confirmed) as 검토_대상;
