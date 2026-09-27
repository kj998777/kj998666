-- #112: 문항 1개 검토(최초 제출/사후 검증) 당 적립 포인트를 10 → 1로 낮춘다. 원장님 지시.
--       (기출 다운로드 가격은 그대로 3포인트 — 0009 참고. 이건 "적립"만 낮추는 변경.)
-- #113: 검토(문제 풀기) 화면에서 원본 시험지 PDF를 새 탭에 열어 그대로 저장할 수 있던 링크
--       ("원본 문제지 PDF 보기")를 화면에서 제거함(앱 코드 변경, app/(tutor)/tutor/review/[itemId]/
--       page.tsx) — 이 마이그레이션 자체와는 무관하지만 같은 작업 묶음이라 기록해 둔다. 문항 이미지
--       뷰어(ProblemPageImage)가 내부적으로 쓰는 /tutor/review/[itemId]/pdf 라우트 자체는 그대로 둠
--       (전체 문제지를 파일로 열람/저장하게 해주던 명시적 링크만 삭제, 문항 크롭 이미지 렌더링에는
--       그 라우트가 계속 필요함).
-- #114: 이미 업로드된 시험 중 "열림" 상태라 지금까지 스토어에 안 올라오던 시험도, 이번엔 테스트로
--       2025년 1학년 2학기 중간고사 범위만 골라 고정 3포인트로 스토어에 추가한다. exams_select_
--       tutor_store RLS(0004)는 status와 무관하게 tutor_download_cost is not null이면 노출하므로
--       이 값만 채우면 되고, RLS/트리거 변경은 필요 없다(0009의 auto_set_tutor_download_cost 트리거는
--       "닫힘으로 막 전환되는 순간"에만 개입하므로 이미 열려 있는 이 시험들에는 관여하지 않음 — 그래서
--       한 번은 이렇게 수동으로 채워 줘야 함). 결과가 괜찮으면 다음에 범위를 넓힐 수 있음(전체 학년/
--       학기로 확대하거나, "열림" 상태 시험 전체를 상시 스토어에 올리는 정책으로 바꾸는 것도 가능 —
--       지금은 원장님 지시대로 이 범위만).

-- -------------------------------------------------------------------------
-- 1. #112 — 최초 제출(primary) 적립 포인트 10 → 1
-- -------------------------------------------------------------------------
create or replace function public.submit_tutor_review(
  p_item_explanation_id uuid,
  p_answer_display text,
  p_solution text
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

  update public.item_explanations
    set answer_display = p_answer_display,
        solution = p_solution,
        tutor_reviewed = true,
        claimed_by = null,
        claim_expires_at = null,
        updated_at = now()
  where id = p_item_explanation_id;

  insert into public.tutor_item_reviews
    (item_explanation_id, exam_id, item_label, tutor_id, kind, answer_display, solution, needs_verification)
  values
    (p_item_explanation_id, v_exam_id, v_item_label, auth.uid(), 'primary', p_answer_display, p_solution, v_needs_verification)
  returning id into v_review_id;

  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
  values (auth.uid(), v_points, 'review_primary', v_exam_id, v_item_label);

  update public.tutor_stats
    set points_balance = points_balance + v_points, reviews_submitted = reviews_submitted + 1
  where tutor_id = auth.uid();

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id);
end;
$$;

-- -------------------------------------------------------------------------
-- 2. #112 — 사후 검증(verify) 적립 포인트 10 → 1
-- -------------------------------------------------------------------------
create or replace function public.submit_tutor_verification(
  p_item_explanation_id uuid,
  p_answer_display text,
  p_solution text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_primary_tutor uuid;
  v_exam_id uuid;
  v_item_label text;
  v_verify_id uuid;
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

  select r.id, r.tutor_id, r.exam_id, r.item_label
    into v_primary_id, v_primary_tutor, v_exam_id, v_item_label
  from public.tutor_item_reviews r
  where r.item_explanation_id = p_item_explanation_id
    and r.kind = 'primary'
    and r.verify_claimed_by = auth.uid()
    and r.verify_claim_expires_at > now()
  for update of r;

  if v_primary_id is null then
    raise exception '먼저 이 문항을 배정받은 뒤 제출해 주세요(배정이 만료됐을 수 있습니다).' using errcode = 'P0037';
  end if;

  update public.tutor_item_reviews
    set verified = true, verify_claimed_by = null, verify_claim_expires_at = null
  where id = v_primary_id;

  insert into public.tutor_item_reviews
    (item_explanation_id, exam_id, item_label, tutor_id, kind, answer_display, solution, matches_primary_review_id)
  values
    (p_item_explanation_id, v_exam_id, v_item_label, auth.uid(), 'verify', p_answer_display, p_solution, v_primary_id)
  returning id into v_verify_id;

  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
  values (auth.uid(), v_points, 'review_verify', v_exam_id, v_item_label);

  update public.tutor_stats
    set points_balance = points_balance + v_points, reviews_submitted = reviews_submitted + 1
  where tutor_id = auth.uid();

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'verifyReviewId', v_verify_id, 'primaryReviewId', v_primary_id);
end;
$$;

-- -------------------------------------------------------------------------
-- 3. #114 — 테스트: 2025년 1학년 2학기 중간고사 범위에서 "열림" 상태인 시험만 골라 고정 3포인트로
--    스토어에 추가(이미 tutor_download_cost가 있는 시험은 건드리지 않음 — 관리자가 이미 다른 값을
--    지정했거나 예전에 판매 중단시킨 경우를 덮어쓰지 않기 위함).
-- -------------------------------------------------------------------------
update public.exams
set tutor_download_cost = 3
where status = '열림'
  and tutor_download_cost is null
  and folder_year = '2025'
  and folder_grade = 1
  and folder_term = 2
  and folder_kind = '중간';
