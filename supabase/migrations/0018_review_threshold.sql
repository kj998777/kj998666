-- #8 (2026-09-28): 검수대기(과외선생님 검토)로 보내는 문항 수 줄이기 + 지금 검토 단계 문항 재분류.
--
-- 지금까지: AI 자동 처리가 끝난 시험은 "모든" 문항이 과외선생님 검토 큐에 들어갔다(AI 확신도는 메시지에만
-- 쓰이고 큐 조건에는 안 쓰였음). 그래서 확신이 높은 문항까지 전부 사람이 다시 풀어야 했다.
--
-- 새 기준(앱 코드 lib/ai/pipeline.ts와 같음): 검토 큐에는
--   - AI 확신도가 low(애매·시험지 인쇄 정답과 다름·답 없음)이거나 fail(풀이 실패)인 문항,
--   - 시험지 오류 정정(정오표)이 만들어진 문항만 보낸다.
-- 확신도 high/medium 문항은 "AI 확신"으로 바로 정답 확정(review_confirmed, 0016)한다.
--
-- 이 마이그레이션이 하는 일:
--   1. 검토 큐(claim_next_review_item)가 이미 확정된 문항은 배정하지 않게 한다.
--   2. 과외선생님 제출(submit_tutor_review)이 이미 확정된 문항은 받지 않게 한다(재분류 순간 풀고 있던 경우 대비).
--   3. 지금 검수대기 시험의 아직 아무도 제출하지 않은 문항을 새 기준으로 다시 분류한다(확신도는 exam_jobs에
--      저장돼 있던 AI 처리 결과 state.flags에서 읽음 — 기록이 없으면 안전하게 검토 대상으로 남김).
--   4. 그 결과 모든 문항이 확정된 검수대기 시험은 #1 규칙대로 자동으로 연다(열리면 0014 트리거가 스토어
--      가격도 매김). 과외선생님이 이미 제출했지만 확정 전인 문항이 남은 시험은 열지 않는다 — 검토현황
--      (/admin/review-status)의 "AI와 일치하는 문항 일괄 확정"으로 정리하면 된다.
--
-- 0016 다음에 실행해야 한다(review_confirmed 열이 필요).

-- -------------------------------------------------------------------------
-- 1. 검토 큐 — 0004 본문 + "and not ie.review_confirmed"
-- -------------------------------------------------------------------------
create or replace function public.claim_next_review_item()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 검토할 수 있습니다.' using errcode = 'P0030';
  end if;

  select ie.id into v_item_id
  from public.item_explanations ie
  join public.exams e on e.id = ie.exam_id
  where e.status = '검수대기'
    and not ie.tutor_reviewed
    and not ie.review_confirmed
    and (ie.claimed_by is null or ie.claim_expires_at < now())
  order by ie.updated_at
  limit 1
  for update of ie skip locked;

  if v_item_id is not null then
    update public.item_explanations
      set claimed_by = auth.uid(), claim_expires_at = now() + interval '30 minutes'
    where id = v_item_id;
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
  end if;

  v_item_id := public.claim_verification_item();
  if v_item_id is not null then
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'verify');
  end if;

  return null;
end;
$$;

grant execute on function public.claim_next_review_item() to authenticated;

-- -------------------------------------------------------------------------
-- 2. submit_tutor_review — 0016 본문 + 이미 확정된 문항 거부
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

  v_needs_verification := random() < 0.15;

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
-- 3. 재분류 — 검수대기 시험의 "아직 아무도 제출하지 않은" 미확정 문항 중 AI 확신도 high/medium이고
--    정오표 항목이 없는 문항을 "AI 확신"으로 확정.
-- -------------------------------------------------------------------------
update public.item_explanations ie
set review_confirmed = true,
    review_confirm_source = 'ai_confident',
    review_confirmed_at = now(),
    claimed_by = null,
    claim_expires_at = null
from public.exams e, public.exam_jobs j
where e.id = ie.exam_id
  and j.exam_id = ie.exam_id
  and e.status = '검수대기'
  and not ie.review_confirmed
  and not ie.tutor_reviewed
  and (j.state -> 'flags' -> ie.item_label ->> 'c') in ('high', 'medium')
  and not exists (
    select 1 from public.exam_corrections c
    where c.exam_id = ie.exam_id and c.item_label = ie.item_label
  );

-- -------------------------------------------------------------------------
-- 4. 모든 문항이 확정된 검수대기 시험 자동 열기(#1 규칙). 정답표가 없는 시험은 열 수 없으므로 제외.
-- -------------------------------------------------------------------------
with opened as (
  update public.exams e
  set status = '열림'
  where e.status = '검수대기'
    and exists (select 1 from public.item_explanations x where x.exam_id = e.id)
    and not exists (select 1 from public.item_explanations x where x.exam_id = e.id and not x.review_confirmed)
    and exists (select 1 from public.answer_key k where k.exam_id = e.id)
  returning e.id
)
update public.exam_jobs j
set stage = 'done',
    message = '검토 기준 변경(#8)으로 모든 문항의 정답이 확정되어 자동으로 시험을 열었습니다.',
    updated_at = now()
from opened
where j.exam_id = opened.id and j.stage = 'review';

-- -------------------------------------------------------------------------
-- 확인용:
--   select review_confirm_source, count(*) from public.item_explanations group by 1;
--   select e.name, count(*) filter (where not ie.review_confirmed) as 남은_검토
--   from public.item_explanations ie join public.exams e on e.id = ie.exam_id
--   where e.status = '검수대기' group by e.name order by 2 desc;
-- -------------------------------------------------------------------------
