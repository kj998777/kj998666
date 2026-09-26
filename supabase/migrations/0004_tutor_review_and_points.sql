-- =========================================================================
-- 학원 시험관리 시스템 v3 — 과외선생님(tutor) 검토·포인트·기출 다운로드
--
-- 배경: 검수대기 문항 중 확신이 낮은 것들을 선생님이 직접 풀어 고쳐야 했다. 이제 그 작업을
-- 과외 때문에 기출문제가 필요한 후배(의대생)들에게 맡기고, 대가로 포인트를 주고, 그 포인트로
-- 기출문제(PDF)를 돈 대신 받아가게 한다. "선반영 후 사후 샘플 검증" 방식 — 제출하면 즉시
-- 반영+적립되고, 일부를 무작위로 다른 과외선생님에게 다시 풀게 해서 사후 검증한다.
--
-- 아주 중요한 안전장치: is_staff()는 지금까지 "role이 null이 아니면 직원"이라고 판단했다.
-- tutor도 role 값을 가지므로 이 함수를 그대로 두면 tutor가 학생 개인정보·채점결과 등 직원 전용
-- 테이블 전체에 접근할 수 있게 된다. 그래서 is_staff()를 admin/editor/viewer로만 명시적으로
-- 좁히고, tutor 전용 접근은 아래에서 새로 추가하는 좁은 정책으로만 허용한다.
--
-- 실행 순서 참고: 원본 설계 문서의 섹션 번호는 그대로 유지하되, 테이블 생성이 그 테이블을
-- 참조하는 RLS 정책보다 먼저 오도록 순서만 재배열했다(정책이 존재하지 않는 테이블을 참조하면
-- "relation does not exist" 오류가 나기 때문). 내용은 원본과 동일하다.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. profiles.role 에 'tutor' 추가
-- -------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'editor', 'viewer', 'tutor'));

-- 가입 트리거: tutor로 가입 확정되면 tutor_stats 행도 함께 만든다(아래에서 테이블 생성 후 참조하므로
-- 함수 자체는 여기서 미리 다시 만들어 두고, 트리거는 그대로 재사용됨 — CREATE OR REPLACE라 안전).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  v_role text := case
    when requested_role in ('admin', 'editor', 'viewer', 'tutor') then requested_role
    else 'viewer'
  end;
begin
  insert into public.profiles (id, email, role) values (new.id, new.email, v_role);
  if v_role = 'tutor' then
    insert into public.tutor_stats (tutor_id) values (new.id);
  end if;
  return new;
end;
$$;
-- 주의: 위 함수는 tutor_stats 테이블을 참조하지만, Postgres 함수 본문은 생성 시점에 테이블 존재
-- 여부를 검사하지 않으므로(plpgsql은 실행 시점에만 이름을 확인) 이 순서(함수 먼저, 테이블 나중)로
-- 실행해도 문제없다. 실제 INSERT는 이 마이그레이션이 끝난 뒤 트리거가 실행될 때만 일어난다.

-- -------------------------------------------------------------------------
-- 2. is_staff() 를 admin/editor/viewer로 명시적으로 좁히고, is_tutor() 신설
--    — 이 한 줄 수정만으로 기존 모든 is_staff() 기반 RLS(직원 전용 테이블 전체·exam-pdfs 버킷)가
--      tutor를 자동으로 차단하게 된다.
-- -------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_profile_role() in ('admin', 'editor', 'viewer');
$$;

create or replace function public.is_tutor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_profile_role() = 'tutor';
$$;

-- -------------------------------------------------------------------------
-- 3. tutor_stats — 과외선생님 포인트 잔액 + 통계(1인당 1행)
-- -------------------------------------------------------------------------
create table public.tutor_stats (
  tutor_id uuid primary key references public.profiles (id) on delete cascade,
  points_balance int not null default 0,
  reviews_submitted int not null default 0,
  reviews_flagged int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.tutor_stats is
  '과외선생님 포인트 잔액·통계. 클라이언트가 직접 쓸 수 없고 아래 RPC들만 갱신한다(SECURITY DEFINER).';

alter table public.tutor_stats enable row level security;

create policy "tutor_stats_select_own_or_admin"
  on public.tutor_stats for select to authenticated
  using (tutor_id = auth.uid() or public.is_admin());

grant select on public.tutor_stats to authenticated;

-- -------------------------------------------------------------------------
-- 4. tutor_points_ledger — 포인트 적립/차감 감사 기록
-- -------------------------------------------------------------------------
create table public.tutor_points_ledger (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment')),
  ref_exam_id uuid references public.exams (id) on delete set null,
  ref_item_label text,
  created_at timestamptz not null default now()
);

alter table public.tutor_points_ledger enable row level security;

create policy "tutor_points_ledger_select_own_or_admin"
  on public.tutor_points_ledger for select to authenticated
  using (tutor_id = auth.uid() or public.is_admin());

grant select on public.tutor_points_ledger to authenticated;

-- -------------------------------------------------------------------------
-- 5. item_explanations — 검토 큐 상태 열 추가(별도 큐 테이블 없이 이 테이블을 큐로 사용)
--    (참조 정책은 tutor_item_reviews 테이블 생성 뒤로 옮김 — 아래 5b 참고)
-- -------------------------------------------------------------------------
alter table public.item_explanations add column tutor_reviewed boolean not null default false;
alter table public.item_explanations add column claimed_by uuid references public.profiles (id) on delete set null;
alter table public.item_explanations add column claim_expires_at timestamptz;

comment on column public.item_explanations.tutor_reviewed is
  '과외선생님이 이 문항을 한 번이라도 풀어서 제출했는지. 큐 조건: exam.status=검수대기 and not tutor_reviewed.';

-- -------------------------------------------------------------------------
-- 6. tutor_item_reviews — 과외선생님 제출 기록(최초 제출 kind=primary, 사후검증 제출 kind=verify)
-- -------------------------------------------------------------------------
create table public.tutor_item_reviews (
  id uuid primary key default gen_random_uuid(),
  item_explanation_id uuid not null references public.item_explanations (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null,
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('primary', 'verify')),
  answer_display text not null check (char_length(answer_display) between 1 and 500),
  solution text not null default '' check (char_length(solution) <= 4000),
  -- 아래 5개 열은 kind='primary' 행에서만 의미 있음(사후 검증 배정 상태)
  needs_verification boolean not null default false,
  verified boolean not null default false,
  verify_claimed_by uuid references public.profiles (id) on delete set null,
  verify_claim_expires_at timestamptz,
  -- 아래 2개 열은 kind='verify' 행에서만 의미 있음
  matches_primary_review_id uuid references public.tutor_item_reviews (id) on delete set null,
  is_match boolean,
  -- primary 행의 최종 해소 여부(검증 결과 일치=자동 true, 불일치=false로 남아 관리자 화면에 노출)
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.tutor_item_reviews is
  '과외선생님 검토 제출 기록. kind=primary는 즉시 반영된 최초 제출, kind=verify는 사후 샘플 검증
   제출(블라인드 재검증). resolved=false and is_match=false 인 primary 행이 관리자 분쟁 목록 대상.';

alter table public.tutor_item_reviews enable row level security;

create policy "tutor_item_reviews_select_own_or_staff"
  on public.tutor_item_reviews for select to authenticated
  using (tutor_id = auth.uid() or public.is_editor_or_admin());

create policy "tutor_item_reviews_update_admin"
  on public.tutor_item_reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, update on public.tutor_item_reviews to authenticated;

-- 5b. item_explanations 정책 — 위 tutor_item_reviews 테이블이 이제 존재하므로 여기서 추가한다.
-- 과외선생님은 본인이 지금 선점(claimed_by) 중이거나, 사후 검증으로 배정받은 문항만 볼 수 있다
-- (기존 item_explanations_select_staff 정책과 별개로 OR 조건으로 추가됨 — 직원 열람 범위는 그대로).
create policy "item_explanations_select_tutor_claimed"
  on public.item_explanations for select to authenticated
  using (
    public.is_tutor() and (
      claimed_by = auth.uid()
      or exists (
        select 1 from public.tutor_item_reviews r
        where r.item_explanation_id = item_explanations.id
          and r.kind = 'primary'
          and r.verify_claimed_by = auth.uid()
      )
    )
  );

-- -------------------------------------------------------------------------
-- 7. exams.tutor_download_cost — null이면 과외선생님 판매 대상 아님
--    (참조 정책은 tutor_exam_purchases 테이블 생성 뒤로 옮김 — 아래 7b 참고)
-- -------------------------------------------------------------------------
alter table public.exams add column tutor_download_cost int check (tutor_download_cost is null or tutor_download_cost > 0);

comment on column public.exams.tutor_download_cost is
  '과외선생님이 이 시험 PDF를 받으려면 필요한 포인트. null=미판매. editor 이상이 시험 상세에서 지정.';

-- -------------------------------------------------------------------------
-- 8. tutor_exam_purchases — 한 번 구매하면 재다운로드 무제한 무료
-- -------------------------------------------------------------------------
create table public.tutor_exam_purchases (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  points_spent int not null default 0,
  purchased_at timestamptz not null default now(),
  unique (tutor_id, exam_id)
);

alter table public.tutor_exam_purchases enable row level security;

create policy "tutor_exam_purchases_select_own_or_admin"
  on public.tutor_exam_purchases for select to authenticated
  using (tutor_id = auth.uid() or public.is_admin());

grant select on public.tutor_exam_purchases to authenticated;

-- 7b. exams 정책 — 위 tutor_exam_purchases 테이블이 이제 존재하므로 여기서 추가한다.
-- 과외선생님은 "지금 판매 중"이거나 "이미 구매한 적 있는" 시험만 볼 수 있다(익명/직원 정책과 별개).
create policy "exams_select_tutor_store"
  on public.exams for select to authenticated
  using (
    public.is_tutor() and (
      tutor_download_cost is not null
      or exists (
        select 1 from public.tutor_exam_purchases p
        where p.exam_id = exams.id and p.tutor_id = auth.uid()
      )
    )
  );

-- 과외선생님이 지금 검토 중인 문항이 속한 시험도 볼 수 있어야(문제 위치 확인 등) 함.
create policy "exams_select_tutor_active_review"
  on public.exams for select to authenticated
  using (
    public.is_tutor() and exists (
      select 1 from public.item_explanations ie
      where ie.exam_id = exams.id and (
        ie.claimed_by = auth.uid()
        or exists (
          select 1 from public.tutor_item_reviews r
          where r.item_explanation_id = ie.id and r.kind = 'primary' and r.verify_claimed_by = auth.uid()
        )
      )
    )
  );

-- =========================================================================
-- 9. RPC — 동시성·포인트가 걸린 쓰기는 전부 SECURITY DEFINER 함수로(submit_and_grade와 같은 패턴).
--    포인트 단가(10점/문항)·샘플링 비율(15%)·클레임 유효시간(30분)은 이번엔 상수로 하드코딩.
-- =========================================================================

-- 9-1. 검증 전용 내부 헬퍼: 사후 검증 대상 하나를 선점
create or replace function public.claim_verification_item()
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
  where r.kind = 'primary'
    and r.needs_verification
    and not r.verified
    and r.tutor_id <> auth.uid()
    and e.status = '검수대기'
    and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
  order by r.created_at
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

-- 9-2. 큐 진입점 — 새 문항(primary)을 우선 배정하고, 없으면 사후 검증 대상을 배정한다.
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

-- 9-3. 클레임 포기(다른 문항을 받고 싶을 때)
create or replace function public.release_review_claim(p_item_explanation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 사용할 수 있습니다.' using errcode = 'P0030';
  end if;

  update public.item_explanations
    set claimed_by = null, claim_expires_at = null
  where id = p_item_explanation_id and claimed_by = auth.uid();

  update public.tutor_item_reviews
    set verify_claimed_by = null, verify_claim_expires_at = null
  where item_explanation_id = p_item_explanation_id and kind = 'primary' and verify_claimed_by = auth.uid();
end;
$$;

-- 9-4. 최초 제출(primary) — 즉시 반영 + 즉시 적립 + 15% 확률로 사후 검증 대상 지정
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

-- 9-5. 사후 검증 제출 — 원자적 삽입만 담당(일치 여부 판정은 서버 액션이 lib/grading.ts로 계산해서
--      바로 아래 resolve_tutor_verification()에 넘긴다 — 동치 판정 로직을 두 곳에 중복 구현하지 않기 위함).
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

-- 9-6. 사후 검증 결과 확정 — 서버 액션이 lib/grading.ts로 계산한 is_match를 그대로 받아 반영.
create or replace function public.resolve_tutor_verification(p_verify_review_id uuid, p_is_match boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_primary_tutor uuid;
begin
  update public.tutor_item_reviews
    set is_match = p_is_match
  where id = p_verify_review_id and kind = 'verify' and tutor_id = auth.uid()
  returning matches_primary_review_id into v_primary_id;

  if v_primary_id is null then
    raise exception '검증 기록을 찾을 수 없습니다.' using errcode = 'P0038';
  end if;

  update public.tutor_item_reviews
    set resolved = p_is_match
  where id = v_primary_id
  returning tutor_id into v_primary_tutor;

  if not p_is_match then
    update public.tutor_stats set reviews_flagged = reviews_flagged + 1 where tutor_id = v_primary_tutor;
  end if;
end;
$$;

-- 9-7. 기출문제 구매 — 이미 구매했으면 무료로 통과(재다운로드), 아니면 포인트 차감 후 구매 기록.
create or replace function public.purchase_exam_download(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost int;
  v_balance int;
  v_already boolean;
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 구매할 수 있습니다.' using errcode = 'P0030';
  end if;

  select exists(
    select 1 from public.tutor_exam_purchases where tutor_id = auth.uid() and exam_id = p_exam_id
  ) into v_already;
  if v_already then
    return jsonb_build_object('ok', true, 'alreadyOwned', true);
  end if;

  select tutor_download_cost into v_cost from public.exams where id = p_exam_id;
  if v_cost is null then
    raise exception '이 시험은 다운로드 대상이 아닙니다.' using errcode = 'P0039';
  end if;

  select points_balance into v_balance from public.tutor_stats where tutor_id = auth.uid() for update;
  if v_balance is null or v_balance < v_cost then
    raise exception '포인트가 부족합니다.' using errcode = 'P0040';
  end if;

  update public.tutor_stats set points_balance = points_balance - v_cost where tutor_id = auth.uid();
  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id)
  values (auth.uid(), -v_cost, 'download_purchase', p_exam_id);
  insert into public.tutor_exam_purchases (tutor_id, exam_id, points_spent) values (auth.uid(), p_exam_id, v_cost);

  return jsonb_build_object('ok', true, 'alreadyOwned', false, 'pointsSpent', v_cost);
end;
$$;

grant execute on function public.claim_verification_item() to authenticated;
grant execute on function public.claim_next_review_item() to authenticated;
grant execute on function public.release_review_claim(uuid) to authenticated;
grant execute on function public.submit_tutor_review(uuid, text, text) to authenticated;
grant execute on function public.submit_tutor_verification(uuid, text, text) to authenticated;
grant execute on function public.resolve_tutor_verification(uuid, boolean) to authenticated;
grant execute on function public.purchase_exam_download(uuid) to authenticated;

-- =========================================================================
-- 이 마이그레이션은 이미 Supabase 프로덕션 DB에 적용되었습니다(2026-09-27).
-- 확인할 것:
--   select is_staff(), is_tutor(); -- (본인 계정 role에 맞게 하나만 true)
--   select * from tutor_stats limit 1; -- tutor로 가입한 계정이 있으면 자동 생성됐는지
-- =========================================================================
