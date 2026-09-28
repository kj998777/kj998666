-- #1 (신규 요청): 기출스토어 등록기준 변경.
--   1) AI가 해설을 작성해 시험이 "검수대기" 상태가 된 뒤, 그 시험의 검토대기 문항
--      (item_explanations, tutor_reviewed=false)이 과외선생님 검토 제출(submit_tutor_review)로
--      전부 답이 들어오면(tutor_reviewed=true), 관리자가 수동으로 "정답 확인 완료 — 시험 열기"
--      버튼을 누르지 않아도 자동으로 시험 상태를 "열림"으로 바꾼다. 기존 수동 버튼
--      (approveAiReview, app/(staff)/exams/ai-actions.ts)은 그대로 남겨 두어, 검토가 덜 끝난
--      상태에서도 관리자가 원하면 여전히 수동으로 먼저 열 수 있다 — 이번 자동화는 그 수동 절차를
--      "검토가 다 끝났을 때" 대신 해주는 것뿐, 기존 경로를 막지 않는다.
--   2) 기출스토어 자동 가격 책정(0009의 auto_set_tutor_download_cost 트리거)의 기준을
--      "닫힘으로 전환되는 순간"에서 "열림으로 전환되는 순간"으로 바꾼다 — 원장님 확인(2026-09-28):
--      검토가 끝나 정답이 확정된 시점(=열림)이 실제로 신뢰할 수 있는 시점이므로, 그 즉시 스토어에
--      등록 가능해야 한다(기존처럼 "학교 시험 제출기간이 끝나는 시점"인 닫힘까지 기다릴 필요 없음).
--      이미 "닫힘" 상태로 등록되어 팔리고 있는 기존 기출은 그대로 둔다(소급 해제하지 않음 — 이미
--      구매한 과외선생님의 재다운로드 권한(tutor_exam_purchases)과도 무관하게 계속 그대로 유지됨).
--   3) 서버 액션(updateTutorDownloadCost)에도 "열림 상태인 시험만 스토어에 등록 가능"을 강제한다
--      (지금까지는 화면에서만 '닫힘' 상태일 때 입력칸을 보여주는 식이었고, 서버 액션 자체에는 상태
--      검사가 전혀 없어 우회 가능한 허점이 있었다 — 이번에 함께 막는다). 앱 코드 변경은 이 마이그레이션
--      과 별도 커밋(app/(staff)/exams/[code]/actions.ts, page.tsx, TutorDownloadCostInput.tsx)으로 진행.

-- -------------------------------------------------------------------------
-- 1. submit_tutor_review — 검토 제출 시 tutor_reviewed=true로 바꾼 뒤, 그 시험에 더 이상
--    검토대기 문항(tutor_reviewed=false)이 남아있지 않으면 시험을 자동으로 "열림"으로 전환하고
--    exam_jobs도 review → done으로 마무리한다. 0011의 4-인자 시그니처 본문을 그대로 가져와
--    이 로직만 추가한다(포인트 적립 등 기존 동작은 전부 동일).
--    - 같은 시험을 두 과외선생님이 "동시에" 마지막 문항 두 개를 각각 제출해 둘 다 "이게 마지막"
--      이라고 판단하는 경합을 막기 위해, 완료 여부를 세기 직전에 exams 행을 for update로 잠근다
--      (아주 짧게, 이 함수가 끝날 때 자동으로 풀림). 두 번째 트랜잭션은 시험이 이미 '열림'으로 바뀐
--      뒤에 조건절(and status = '검수대기')에 걸려 아무 일도 하지 않고 조용히 지나간다.
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
  v_remaining int;
  v_exam_opened boolean := false;
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

  -- #1: 이 시험에 남은 검토대기 문항이 있는지 확인 — 경합 방지를 위해 exams 행을 짧게 잠근다.
  perform 1 from public.exams where id = v_exam_id for update;

  select count(*) into v_remaining
  from public.item_explanations
  where exam_id = v_exam_id and not tutor_reviewed;

  if v_remaining = 0 then
    update public.exams set status = '열림' where id = v_exam_id and status = '검수대기';
    if found then
      v_exam_opened := true;
      update public.exam_jobs
        set stage = 'done', message = '과외선생님 검토가 모두 끝나 자동으로 시험을 열었습니다.', updated_at = now()
      where exam_id = v_exam_id and stage = 'review';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'reviewId', v_review_id, 'examOpened', v_exam_opened);
end;
$$;

grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 2. auto_set_tutor_download_cost — 기준을 "닫힘" → "열림"으로 변경. 0009의 원본 로직·주석
--    구조는 그대로 유지하고 상태 문자열만 바꾼다.
-- -------------------------------------------------------------------------
create or replace function public.auto_set_tutor_download_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = '열림'
     and (tg_op = 'INSERT' or old.status is distinct from '열림')
     and new.tutor_download_cost is null
  then
    new.tutor_download_cost := 3;
  end if;
  return new;
end;
$$;

comment on function public.auto_set_tutor_download_cost() is
  '#1/#108/#110: 시험이 열림 상태로 전환되면(검토 완료 후 자동으로든, 관리자가 수동으로 확정해서든)
   고정 3포인트로 자동 판매 대상이 된다(관리자가 그 뒤 일부러 null로 빼면 그대로 유지 — 이 트리거는
   "막 열린 순간"에만 개입한다). 기존에 "닫힘"으로 등록되어 팔리던 기출은 소급 변경하지 않는다.';
