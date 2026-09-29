-- 0037 — 검토 신뢰성 업그레이드 (2026-09-30 원장님과 확정, 프로젝트 문서 claude/reliability-design.md)
--
--  1. 다수결 확정: 과외선생님 답이 AI(정답표)와 다르면 원장님께 바로 보내지 않고, 다른 선생님(B)이 두 답을 모른 채 다시 푼다.
--     2:1이면 앱 서버가 자동 확정하고, 셋 다 다르면 그때 원장님께(item_explanations.review_stage = 'admin').
--     판정 비교는 채점 규칙(lib/grading.ts)이 필요해서 앱 서버(lib/review/majority.ts)가 서비스롤로 한다.
--  2. 신뢰도 = 정답률: 누가 맞았는지 정해질 때(다수결·원장님 확정·정답 아는 문항·이의제기) tutor_judgments에 기록하고,
--     최근 50건 정답률로 등급을 정한다.  신규(제출 5개 전) · 검증됨 · 우수(30건 이상 95%↑) · 주의(70%↓) · 정지(50%↓)
--     등급이 사후 검증 비율(신규·주의 100%, 검증됨 10%, 우수 5%)과 포인트 배율(우수 1.5배, 주의 0.5배)을 정한다.
--     사후 검증·다수결 판정자는 검증됨·우수 선생님만 맡는다.
--  3. 정답 아는 문항 몰래 섞기(tutor_gold_attempts): 신규는 처음 5문항 중 3문항(1·3·5번째), 그 뒤로 5문항 중 1문항.
--     열린·닫힌 시험 중 사람이 확정한(원장님·다수결·과외 답 일치) 문항에서 고르고, 그 선생님이 스토어에서 받은 시험은 뺀다.
--     화면·포인트는 일반 문항과 같고, 제출해도 원래 해설은 바뀌지 않는다. 섞을 문항이 없으면 일반 문항을 준다.
--  4. 블라인드 보강: 과외선생님 세션이 item_explanations를 직접 읽는 정책(0004)을 없앤다 — 그 정책으로는 행 전체(AI 답·
--     앞사람 답 포함)를 읽을 수 있었다. 이제 tutor_item_access()로 권한만 확인하고, 화면은 서버가 필요한 열만 읽어 보여 준다.
--  5. 이의제기 보상: 포인트 기록 사유에 dispute_reward 추가.
-- 여러 번 실행해도 안전하다. 0036 다음에 실행.

-- -------------------------------------------------------------------------
-- 1. 열·표
-- -------------------------------------------------------------------------
alter table public.item_explanations add column if not exists review_stage text;
alter table public.item_explanations drop constraint if exists item_explanations_review_stage_chk;
alter table public.item_explanations add constraint item_explanations_review_stage_chk
  check (review_stage is null or review_stage in ('second', 'admin'));
comment on column public.item_explanations.review_stage is
  '0037: second = 두 번째 선생님 판정 대기(AI와 다르거나 신규·주의 선생님 제출), admin = 셋 다 달라 원장님 판정 필요.';

alter table public.tutor_item_reviews add column if not exists tiebreak boolean not null default false;
comment on column public.tutor_item_reviews.tiebreak is
  '0037: primary 행 — AI와 달라 다수결 판정이 필요한 제출. 판정(verify) 제출은 포인트 2배, 배정 우선.';

alter table public.tutor_stats add column if not exists points_carry numeric not null default 0;
alter table public.tutor_stats add column if not exists trust_reset_at timestamptz;
alter table public.tutor_stats add column if not exists gold_base int not null default 0;
alter table public.tutor_stats add column if not exists gold_onboarded boolean not null default false;

create table if not exists public.tutor_gold_attempts (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  item_explanation_id uuid not null references public.item_explanations (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null,
  claimed_at timestamptz not null default now(),
  claim_expires_at timestamptz not null default now() + interval '1 hour',
  released boolean not null default false,
  submitted_at timestamptz,
  answer_display text check (answer_display is null or char_length(answer_display) <= 500),
  solution text check (solution is null or char_length(solution) <= 4000),
  image_path text,
  correct boolean,
  unique (tutor_id, item_explanation_id)
);
alter table public.tutor_gold_attempts enable row level security; -- 정책 없음: 서비스롤·아래 함수만(선생님은 몰라야 함)
revoke all on public.tutor_gold_attempts from anon, authenticated;

create table if not exists public.tutor_judgments (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  item_explanation_id uuid references public.item_explanations (id) on delete cascade,
  review_id uuid unique references public.tutor_item_reviews (id) on delete cascade,
  gold_attempt_id uuid unique references public.tutor_gold_attempts (id) on delete cascade,
  correct boolean not null,
  source text not null check (source in ('majority', 'admin', 'gold', 'dispute')),
  created_at timestamptz not null default now(),
  check (review_id is not null or gold_attempt_id is not null)
);
create index if not exists tutor_judgments_tutor_idx on public.tutor_judgments (tutor_id, created_at desc);
alter table public.tutor_judgments enable row level security;
drop policy if exists "tutor_judgments_select_admin" on public.tutor_judgments;
create policy "tutor_judgments_select_admin" on public.tutor_judgments for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.tutor_judgments from authenticated;
grant select on public.tutor_judgments to authenticated;

-- 포인트 기록 사유: 이의제기 보상 추가
alter table public.tutor_points_ledger drop constraint if exists tutor_points_ledger_reason_check;
alter table public.tutor_points_ledger add constraint tutor_points_ledger_reason_check
  check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment', 'dispute_reward'));

-- 이미 5개 넘게 제출한 선생님은 "처음 5문항 중 3문항" 온보딩을 건너뛰고, 지금부터 5문항에 1문항씩만 섞는다
update public.tutor_stats ts
   set gold_base = x.n, gold_onboarded = true
  from (select tutor_id, count(*)::int as n from public.tutor_item_reviews group by tutor_id) x
 where x.tutor_id = ts.tutor_id and x.n >= 5 and not ts.gold_onboarded;

-- -------------------------------------------------------------------------
-- 2. 등급(정답률)
-- -------------------------------------------------------------------------
create or replace function public.tutor_trust_level(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paused boolean;
  v_reset timestamptz;
  v_done int;
  v_judged int;
  v_correct int;
  v_acc numeric;
begin
  -- 본인·관리자·서버(서비스롤, auth.uid() 없음)만 조회
  if auth.uid() is not null and p_tutor <> auth.uid() and not public.is_admin() then
    return null;
  end if;
  select review_paused, trust_reset_at into v_paused, v_reset from public.tutor_stats where tutor_id = p_tutor;
  if not found then
    return 'new';
  end if;
  if v_paused then
    return 'paused';
  end if;
  v_done := (select count(*) from public.tutor_item_reviews where tutor_id = p_tutor)
          + (select count(*) from public.tutor_gold_attempts where tutor_id = p_tutor and submitted_at is not null);
  if v_done < 5 then
    return 'new';
  end if;
  select count(*), count(*) filter (where correct) into v_judged, v_correct
  from (select correct from public.tutor_judgments
         where tutor_id = p_tutor and (v_reset is null or created_at > v_reset)
         order by created_at desc limit 50) j;
  if v_judged < 5 then
    return 'ok';
  end if;
  v_acc := v_correct::numeric / v_judged;
  if v_acc < 0.5 then
    return 'paused';
  end if;
  if v_acc < 0.7 then
    return 'watch';
  end if;
  if v_judged >= 30 and v_acc >= 0.95 then
    return 'top';
  end if;
  return 'ok';
end;
$$;
grant execute on function public.tutor_trust_level(uuid) to authenticated;

-- 등급별 정답률 요약(대시보드·운영 현황 표시용): {judged, correct}
create or replace function public.tutor_accuracy(p_tutor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reset timestamptz;
  v_judged int;
  v_correct int;
begin
  if auth.uid() is not null and p_tutor <> auth.uid() and not public.is_admin() then
    return null;
  end if;
  select trust_reset_at into v_reset from public.tutor_stats where tutor_id = p_tutor;
  select count(*), count(*) filter (where correct) into v_judged, v_correct
  from (select correct from public.tutor_judgments
         where tutor_id = p_tutor and (v_reset is null or created_at > v_reset)
         order by created_at desc limit 50) j;
  return jsonb_build_object('judged', v_judged, 'correct', v_correct);
end;
$$;
grant execute on function public.tutor_accuracy(uuid) to authenticated;

-- 포인트 적립(배율·소수점 이월). 다른 함수 안에서만 부른다.
create or replace function public.award_review_points(p_tutor uuid, p_base numeric, p_reason text, p_exam uuid, p_label text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text := public.tutor_trust_level(p_tutor);
  v_mult numeric := case v_level when 'top' then 1.5 when 'watch' then 0.5 else 1 end;
  v_carry numeric;
  v_total numeric;
  v_points int;
begin
  select points_carry into v_carry from public.tutor_stats where tutor_id = p_tutor for update;
  v_total := p_base * v_mult + coalesce(v_carry, 0);
  v_points := floor(v_total);
  if v_points > 0 then
    insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
    values (p_tutor, v_points, p_reason, p_exam, p_label);
  end if;
  update public.tutor_stats
     set points_balance = points_balance + v_points,
         reviews_submitted = reviews_submitted + 1,
         points_carry = v_total - v_points
   where tutor_id = p_tutor;
  return v_points;
end;
$$;
revoke all on function public.award_review_points(uuid, numeric, text, uuid, text) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. 최초 제출 — 0028 본문 + 등급별 사후 검증 비율 + 배율 적립
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
  v_level text;
  v_points int;
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
$$;
grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 4. 사후 검증·다수결 판정 제출 — 0028 본문 + 판정 문항 2배 + 배율 적립
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
  v_tiebreak boolean;
  v_verify_id uuid;
  v_points int;
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

  select r.id, r.tutor_id, r.exam_id, r.item_label, r.tiebreak
    into v_primary_id, v_primary_tutor, v_exam_id, v_item_label, v_tiebreak
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

  -- 0037: 다수결 판정 문항(어려운 문항)은 2배
  v_points := public.award_review_points(
    auth.uid(),
    public.review_points_for_item(p_item_explanation_id) * (case when v_tiebreak then 2 else 1 end),
    'review_verify', v_exam_id, v_item_label);

  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'verifyReviewId', v_verify_id, 'primaryReviewId', v_primary_id, 'tiebreak', v_tiebreak);
end;
$$;
grant execute on function public.submit_tutor_verification(uuid, text, text, text) to authenticated;

-- 0037: 불일치 횟수(reviews_flagged)는 더 이상 신뢰도에 쓰지 않는다 — 누가 맞았는지는 앱 서버가 tutor_judgments에 기록.
-- 이 함수는 검증 결과(일치 여부)만 남긴다.
create or replace function public.resolve_tutor_verification(p_verify_review_id uuid, p_is_match boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
begin
  update public.tutor_item_reviews
    set is_match = p_is_match
  where id = p_verify_review_id and kind = 'verify' and tutor_id = auth.uid()
  returning matches_primary_review_id into v_primary_id;
  if v_primary_id is null then
    raise exception '검증 기록을 찾을 수 없습니다.' using errcode = 'P0038';
  end if;
  update public.tutor_item_reviews set resolved = p_is_match where id = v_primary_id;
end;
$$;
grant execute on function public.resolve_tutor_verification(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 5. 배정 — 사후 검증·판정은 검증됨·우수만, 판정 문항 먼저 / 정답 아는 문항 섞기
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
           r.tiebreak desc,
           e.is_jeju desc,
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

-- 정답 아는 문항을 줄 차례인가: 신규는 1·3·5번째, 그 뒤로 5문항마다 1문항(밀린 만큼은 다음 기회에)
create or replace function public.gold_due(p_tutor uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base int;
  v_onboarded boolean;
  v_done int;
  v_gold int;
  v_n int;
  v_target int;
begin
  select gold_base, gold_onboarded into v_base, v_onboarded from public.tutor_stats where tutor_id = p_tutor;
  v_base := coalesce(v_base, 0);
  v_gold := (select count(*) from public.tutor_gold_attempts
              where tutor_id = p_tutor and submitted_at is not null);
  v_done := (select count(*) from public.tutor_item_reviews where tutor_id = p_tutor) + v_gold;
  v_n := v_done - v_base + 1; -- 이번에 받을 문항이 몇 번째인가(기준점 이후)
  if coalesce(v_onboarded, false) then
    v_target := v_n / 5; -- 기준점(0037 적용 시점) 이후 5문항마다 1문항(정답 아는 문항은 전부 기준점 이후에 생김)
  elsif v_n <= 5 then
    v_target := (case when v_n >= 1 then 1 else 0 end) + (case when v_n >= 3 then 1 else 0 end) + (case when v_n >= 5 then 1 else 0 end);
  else
    v_target := 3 + (v_n - 5) / 5;
  end if;
  return v_gold < v_target;
end;
$$;
revoke all on function public.gold_due(uuid) from public, anon, authenticated;

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
begin
  -- 진짜 검토할 문항이 있을 때만 섞는다(없는데 정답 아는 문항만 주면 포인트만 나감)
  if not exists (
    select 1 from public.item_explanations ie join public.exams e on e.id = ie.exam_id
    where e.status = '검수대기' and not ie.tutor_reviewed and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
  ) and not exists (
    select 1 from public.tutor_item_reviews r join public.exams e on e.id = r.exam_id
    where r.kind = 'primary' and r.needs_verification and not r.verified and r.tutor_id <> auth.uid()
      and e.status = '검수대기' and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
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
  order by random()
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

  if public.tutor_trust_level(auth.uid()) = 'paused' then
    raise exception '검토 배정이 잠시 멈춰 있습니다. 최근 제출의 정답률이 낮아 원장님 확인을 기다리는 중입니다. 원장님께 문의해 주세요.' using errcode = 'P0060';
  end if;

  -- 0037: 정답 아는 문항(화면에는 새 문항과 똑같이 'primary'로 보낸다)
  v_item_id := public.claim_gold_item();
  if v_item_id is not null then
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
  end if;

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
    where e.status = '검수대기'
      and not ie.tutor_reviewed
      and not ie.review_confirmed
      and (ie.claimed_by is null or ie.claim_expires_at < now())
      and ((s.tutor_id is not null) = v_pass)
    order by s.skipped_at nulls first,
             e.is_jeju desc,
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
grant execute on function public.claim_next_review_item() to authenticated;

-- 포기 — 0022 본문 + 정답 아는 문항 포기(다시 주지 않음)
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

  update public.tutor_gold_attempts
    set released = true
  where item_explanation_id = p_item_explanation_id and tutor_id = auth.uid() and submitted_at is null and not released;

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

-- 정답 아는 문항 제출(채점·판정 기록은 앱 서버가 서비스롤로)
create or replace function public.submit_gold_attempt(
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
  v_id uuid;
  v_exam uuid;
  v_label text;
  v_points int;
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
  select id, exam_id, item_label into v_id, v_exam, v_label
  from public.tutor_gold_attempts
  where item_explanation_id = p_item_explanation_id and tutor_id = auth.uid()
    and submitted_at is null and not released and claim_expires_at > now()
  for update;
  if v_id is null then
    raise exception '먼저 이 문항을 선점한 뒤 제출해 주세요(선점이 만료됐을 수 있습니다).' using errcode = 'P0037';
  end if;
  update public.tutor_gold_attempts
     set submitted_at = now(), answer_display = p_answer_display, solution = p_solution, image_path = p_image_path
   where id = v_id;
  v_points := public.award_review_points(auth.uid(), public.review_points_for_item(p_item_explanation_id), 'review_primary', v_exam, v_label);
  return jsonb_build_object('ok', true, 'pointsEarned', v_points, 'attemptId', v_id, 'examOpened', false);
end;
$$;
grant execute on function public.submit_gold_attempt(uuid, text, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 6. 블라인드 보강: 과외선생님은 item_explanations를 직접 읽지 않는다
-- -------------------------------------------------------------------------
drop policy if exists "item_explanations_select_tutor_claimed" on public.item_explanations;

-- 이 선생님이 지금 이 문항을 볼 수 있나: 'primary' | 'verify' | null (정답 아는 문항도 'primary')
create or replace function public.tutor_item_access(p_item_explanation_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_tutor() then null
    when exists (select 1 from public.item_explanations ie
                  where ie.id = p_item_explanation_id and ie.claimed_by = auth.uid() and ie.claim_expires_at > now()) then 'primary'
    when exists (select 1 from public.tutor_gold_attempts g
                  where g.item_explanation_id = p_item_explanation_id and g.tutor_id = auth.uid()
                    and g.submitted_at is null and not g.released and g.claim_expires_at > now()) then 'primary'
    when exists (select 1 from public.tutor_item_reviews r
                  where r.item_explanation_id = p_item_explanation_id and r.kind = 'primary'
                    and r.verify_claimed_by = auth.uid() and r.verify_claim_expires_at > now()) then 'verify'
    else null end;
$$;
grant execute on function public.tutor_item_access(uuid) to authenticated;

-- 확인용(모두 1 이상 / true)
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tutor_gold_attempts', 'tutor_judgments')) as 새_표_2,
  (select count(*) from pg_proc where proname in ('tutor_item_access', 'claim_gold_item', 'submit_gold_attempt', 'award_review_points', 'tutor_accuracy')) as 새_함수_5,
  (select count(*) = 0 from pg_policies where tablename = 'item_explanations' and policyname = 'item_explanations_select_tutor_claimed') as 직접읽기_막음;
