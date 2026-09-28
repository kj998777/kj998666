-- #3 (2026-09-28): 관리자 "검토현황" 화면 + 문항별 정답 확정.
--
-- 지금까지의 문제(코드 조사로 확인):
--   1) 과외선생님이 검토 제출(submit_tutor_review)하면 해설(item_explanations.answer_display/solution)
--      만 덮어쓰고, 학생 채점에 실제로 쓰는 정답표(answer_key.correct_answers)에는 전혀 반영되지
--      않았다. 과외선생님 답이 AI 답과 달라도 채점은 계속 AI 답으로 됐다.
--   2) 덮어쓰기 전에 AI가 만든 원래 정답 표시·해설을 어디에도 남기지 않아, 과외선생님 답이 틀렸을
--      때 AI 해설로 되돌릴 방법이 없었다.
--   3) 마지막 문항이 제출되는 순간(0014) 답이 AI와 같든 다르든 시험이 자동으로 열렸다.
--
-- 바꾸는 점:
--   - item_explanations에 "정답 확정" 상태(review_confirmed 등)와 AI 원본 보관 열(ai_answer_display,
--     ai_solution)을 추가한다.
--   - submit_tutor_review: 덮어쓰기 전에 AI 원본을 보관하고, 시험 자동 열기는 여기서 빼서 앱 서버로
--     옮긴다. 앱 서버(app/(tutor)/tutor/review/actions.ts)가 제출 직후 과외선생님 답과 정답표를
--     lib/grading.ts로 비교해 같으면 자동 확정하고, 시험의 모든 문항이 확정되면 그때 연다.
--     다르면 확정하지 않고 관리자 검토현황 화면(/admin/review-status)에 "AI와 다름"으로 뜬다.
--   - 이미 열림/닫힘 상태인 시험의 문항은 전부 확정된 것으로 소급 처리한다(검토현황에 안 뜨게).
--     검수대기 시험 중 이미 제출된 문항은 확정 전 상태로 남겨, 검토현황에서 "일치 항목 일괄 확정"
--     버튼으로 한 번에 정리할 수 있다.

-- -------------------------------------------------------------------------
-- 1. 열 추가
-- -------------------------------------------------------------------------
alter table public.item_explanations
  add column if not exists review_confirmed boolean not null default false,
  add column if not exists review_confirmed_at timestamptz,
  add column if not exists review_confirmed_by uuid references public.profiles (id) on delete set null,
  add column if not exists review_confirm_source text,
  add column if not exists ai_answer_display text,
  add column if not exists ai_solution text;

alter table public.item_explanations drop constraint if exists item_explanations_review_confirm_source_check;
alter table public.item_explanations add constraint item_explanations_review_confirm_source_check
  check (review_confirm_source is null or review_confirm_source in ('auto_match', 'admin', 'legacy', 'ai_confident'));

comment on column public.item_explanations.review_confirmed is
  '#3: 이 문항의 정답이 확정됐는지. auto_match=과외선생님 답이 정답표와 같아 자동 확정, admin=관리자가
   검토현황에서 확정, legacy=0016 이전에 이미 열린 시험(소급), ai_confident=AI 확신이 높아 검토 생략(#8).
   시험의 모든 문항이 확정되면 검수대기 시험이 자동으로 열린다.';
comment on column public.item_explanations.ai_answer_display is
  '#3: 과외선생님 제출로 덮어쓰기 전 AI가 만든 원래 정답 표시(관리자가 "AI 정답 유지"를 고르면 복원).';

-- -------------------------------------------------------------------------
-- 2. 소급: 검수대기가 아닌 시험의 문항은 전부 확정 처리
-- -------------------------------------------------------------------------
update public.item_explanations ie
set review_confirmed = true,
    review_confirm_source = 'legacy',
    review_confirmed_at = now()
from public.exams e
where e.id = ie.exam_id
  and e.status <> '검수대기'
  and not ie.review_confirmed;

-- -------------------------------------------------------------------------
-- 3. submit_tutor_review — 0014 본문에서 (a) AI 원본 보관 추가, (b) 자동 열기 블록 제거.
--    나머지(선점 확인, 포인트 1점 적립, 15% 사후검증 표본)는 그대로.
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

  select ie.exam_id, ie.item_label, e.status, ie.tutor_reviewed, ie.claimed_by, ie.claim_expires_at
    into v_exam_id, v_item_label, v_exam_status, v_reviewed, v_claimed_by, v_claim_expires
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
  if v_exam_status <> '검수대기' then
    raise exception '지금은 제출할 수 없는 문항입니다.' using errcode = 'P0032';
  end if;
  if v_claimed_by is distinct from auth.uid() or v_claim_expires < now() then
    raise exception '먼저 이 문항을 선점한 뒤 제출해 주세요(선점이 만료됐을 수 있습니다).' using errcode = 'P0037';
  end if;

  v_needs_verification := random() < 0.15;

  -- SET의 오른쪽 식은 "바뀌기 전" 값을 읽으므로, ai_* 에는 AI가 만든 원래 값이 들어간다
  -- (이미 보관된 값이 있으면 그대로 둠).
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

  -- 시험 자동 열기는 앱 서버에서(정답 일치 판정 후) 처리한다 — 위 머리말 참고.
  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id, 'examOpened', false);
end;
$$;

grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 확인용 쿼리(실행 후 참고):
--   select review_confirm_source, count(*) from public.item_explanations group by 1;
--   select e.name, count(*) filter (where not ie.review_confirmed) as unconfirmed
--   from public.item_explanations ie join public.exams e on e.id = ie.exam_id
--   where e.status = '검수대기' group by e.name;
-- -------------------------------------------------------------------------
