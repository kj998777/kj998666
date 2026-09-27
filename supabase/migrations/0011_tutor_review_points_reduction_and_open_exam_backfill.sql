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
--
-- [이 파일은 최초 배포본(commit bc6efc6)을 대체하는 수정본입니다]
-- 최초 배포본은 submit_tutor_review/submit_tutor_verification을 0004 시절의 "3-인자" 시그니처
-- (p_item_explanation_id, p_answer_display, p_solution)로 재정의했습니다. 그런데 0005에서 이미
-- "4-인자" 시그니처(p_image_path text default null 추가)로 함수를 교체하고 3-인자 버전은
-- `drop function if exists ...(uuid, text, text);`로 명시적으로 지웠기 때문에, 앱은 지금 항상
-- 4-인자로 이 함수들을 호출합니다. 최초 배포본을 그대로 실행하면 PostgreSQL이 "다른 시그니처의
-- 새 오버로드"로 인식해 아무도 호출하지 않는 3-인자 함수만 새로 생기고, 실제로 호출되는 4-인자
-- 함수는 그대로 남아 포인트가 여전히 10으로 적립됩니다(에러 없이 조용히 의도한 효과가 없음).
-- 이 수정본은 0005의 4-인자 함수 본문을 그대로 가져와 v_points만 1로 바꿨습니다.
-- (최초 배포본을 아직 실행하지 않으셨다면 이 파일만 실행하시면 됩니다. 혹시 이미 실행하셨더라도
-- 안전하도록, 아래에서 그 쓸모없는 3-인자 오버로드를 먼저 정리합니다 — 애초에 없었다면 아무 일도
-- 일어나지 않는 무해한 구문입니다.)

-- -------------------------------------------------------------------------
-- 0. 안전장치 — 혹시 최초 배포본(bc6efc6)을 이미 실행하셨을 경우를 대비해, 그때 잘못 생성됐을 수
--    있는 쓸모없는 3-인자 오버로드를 먼저 지운다. 애초에 존재하지 않으면 조용히 통과한다(오류 없음).
-- -------------------------------------------------------------------------
drop function if exists public.submit_tutor_review(uuid, text, text);
drop function if exists public.submit_tutor_verification(uuid, text, text);

-- -------------------------------------------------------------------------
-- 1. #112 — 최초 제출(primary) 적립 포인트 10 → 1 (0005의 4-인자 시그니처 그대로 유지)
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

  update public.item_explanations
    set answer_display = p_answer_display,
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

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id);
end;
$$;

-- -------------------------------------------------------------------------
-- 2. #112 — 사후 검증(verify) 적립 포인트 10 → 1 (0005의 4-인자 시그니처 그대로 유지)
-- -------------------------------------------------------------------------
create or replace function public.submit_tutor_verification(
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
  if p_image_path is not null and char_length(p_image_path) > 500 then
    raise exception '사진 경로가 올바르지 않습니다.' using errcode = 'P0038';
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
    (item_explanation_id, exam_id, item_label, tutor_id, kind, answer_display, solution, matches_primary_review_id, image_path)
  values
    (p_item_explanation_id, v_exam_id, v_item_label, auth.uid(), 'verify', p_answer_display, p_solution, v_primary_id, p_image_path)
  returning id into v_verify_id;

  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
  values (auth.uid(), v_points, 'review_verify', v_exam_id, v_item_label);

  update public.tutor_stats
    set points_balance = points_balance + v_points, reviews_submitted = reviews_submitted + 1
  where tutor_id = auth.uid();

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'verifyReviewId', v_verify_id, 'primaryReviewId', v_primary_id);
end;
$$;

grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;
grant execute on function public.submit_tutor_verification(uuid, text, text, text) to authenticated;

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
