-- 과외선생님 검토 제출(정답/풀이)에 사진을 첨부할 수 있게 한다.
-- 사용자 요구사항: "문제 풀이를 사진으로 찍어서 올려도 되게끔"이지 AI로 디지털화할 필요는 없음 —
-- 그러므로 이 마이그레이션은 사진을 그대로 저장/열람만 하게 만들 뿐, OCR/디지털화 파이프라인과는
-- 전혀 엮지 않는다.

-- -------------------------------------------------------------------------
-- 1. tutor_item_reviews.image_path — 업로드한 사진의 Storage 경로. null이면 사진 없음(선택 입력).
-- -------------------------------------------------------------------------
alter table public.tutor_item_reviews add column image_path text;

comment on column public.tutor_item_reviews.image_path is
  '과외선생님이 풀이를 찍어 올린 사진의 Storage 경로(버킷 tutor-review-photos). null=사진 없음.
   AI 디지털화는 하지 않고 원본 이미지 그대로 저장해서 관리자 화면에서 열람만 한다.';

-- -------------------------------------------------------------------------
-- 2. Storage 버킷 신설 — private, RLS 정책은 일부러 만들지 않는다. exam-pdfs와 달리 이 버킷은
--    클라이언트(브라우저) 세션이 절대 직접 접근하지 않고, 업로드(서버 액션)와 열람(관리자 전용
--    라우트) 모두 서비스롤 클라이언트로만 이뤄진다 — RLS 정책이 하나도 없는 버킷은 authenticated
--    역할에 기본적으로 완전히 잠겨 있으므로(select/insert 모두 거부), 이 편이 더 안전하다.
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tutor-review-photos', 'tutor-review-photos', false)
on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- 3. submit_tutor_review / submit_tutor_verification 에 선택적 사진 경로 인자(p_image_path) 추가.
--    함수 시그니처(인자 개수)가 바뀌므로 기존 3-인자 버전은 명시적으로 지운다.
-- -------------------------------------------------------------------------
drop function if exists public.submit_tutor_review(uuid, text, text);

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
  v_points constant int := 10;
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

drop function if exists public.submit_tutor_verification(uuid, text, text);

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
  v_points constant int := 10;
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
