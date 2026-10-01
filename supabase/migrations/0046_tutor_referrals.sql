-- 0046 과외선생님 친구 초대 보너스(2026-10-01 원장님 요청 — 참여율 올리기)
--   1) 선생님마다 초대 코드(영문·숫자 6자리). 내 활동 화면의 초대 링크 /login?invite=코드 로 가입하면 가입 기록에 코드가 남는다.
--   2) 가입할 때(auth.users 추가) 코드 주인을 찾아 tutor_referrals에 (초대받은 사람, 초대한 사람)을 남긴다. 승인은 지금처럼 원장님이 한다.
--   3) 초대받은 선생님이 문항을 3개째 제출하면 두 사람 모두 +3P(사유 referral_bonus, 한 번만). 랭킹 점수에는 안 들어간다.
--   award_review_points는 0043 본문 + 초대 보너스. 여러 번 실행해도 안전하다. 0045 다음에 실행.

alter table public.tutor_points_ledger drop constraint if exists tutor_points_ledger_reason_check;
alter table public.tutor_points_ledger add constraint tutor_points_ledger_reason_check
  check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment', 'dispute_reward', 'worksheet_purchase', 'first_bonus', 'referral_bonus'));

create table if not exists public.tutor_invite_codes (
  tutor_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);
alter table public.tutor_invite_codes enable row level security;
drop policy if exists "tutor_invite_codes_select_own_or_admin" on public.tutor_invite_codes;
create policy "tutor_invite_codes_select_own_or_admin" on public.tutor_invite_codes for select to authenticated
  using (tutor_id = auth.uid() or coalesce(public.is_admin(), false));
revoke all on public.tutor_invite_codes from anon;
revoke insert, update, delete on public.tutor_invite_codes from authenticated;
grant select on public.tutor_invite_codes to authenticated;

create table if not exists public.tutor_referrals (
  invitee_id uuid primary key references public.profiles (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (invitee_id <> inviter_id)
);
create index if not exists tutor_referrals_inviter_idx on public.tutor_referrals (inviter_id);
alter table public.tutor_referrals enable row level security;
drop policy if exists "tutor_referrals_select_inviter_or_admin" on public.tutor_referrals;
create policy "tutor_referrals_select_inviter_or_admin" on public.tutor_referrals for select to authenticated
  using (inviter_id = auth.uid() or coalesce(public.is_admin(), false));
revoke all on public.tutor_referrals from anon;
revoke insert, update, delete on public.tutor_referrals from authenticated;
grant select on public.tutor_referrals to authenticated;

-- 내 초대 코드(없으면 만든다)
create or replace function public.tutor_my_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  if not coalesce(public.is_tutor(), false) then
    raise exception '과외선생님 계정만 초대 코드를 받을 수 있습니다.' using errcode = 'P0030';
  end if;
  select code into v_code from public.tutor_invite_codes where tutor_id = auth.uid();
  if v_code is not null then
    return v_code;
  end if;
  loop
    v_try := v_try + 1;
    -- 헷갈리는 글자(0·O·1·I) 빼고 6자리
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    begin
      insert into public.tutor_invite_codes (tutor_id, code) values (auth.uid(), v_code);
      return v_code;
    exception when unique_violation then
      select code into v_code from public.tutor_invite_codes where tutor_id = auth.uid();
      if v_code is not null then
        return v_code; -- 동시에 두 번 불린 경우
      end if;
      if v_try > 20 then
        raise;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.tutor_my_invite_code() from public, anon;
grant execute on function public.tutor_my_invite_code() to authenticated;

-- 가입할 때 초대 코드 기록(가입 자체는 어떤 경우에도 막지 않는다)
create or replace function public.record_tutor_referral()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  v_inviter uuid;
begin
  if v_code = '' or v_code !~ '^[A-Z0-9]{6}$' then
    return new;
  end if;
  begin
    select c.tutor_id into v_inviter from public.tutor_invite_codes c where c.code = v_code;
    if v_inviter is not null and v_inviter <> new.id and exists (select 1 from public.profiles where id = new.id) then
      insert into public.tutor_referrals (invitee_id, inviter_id, code) values (new.id, v_inviter, v_code)
      on conflict (invitee_id) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function public.record_tutor_referral() from public, anon, authenticated;
drop trigger if exists on_auth_user_referral on auth.users;
create trigger on_auth_user_referral
  after insert on auth.users
  for each row execute function public.record_tutor_referral();

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
  v_done int;
  v_inviter uuid;
  v_total numeric;
  v_points int;
begin
  select points_carry, reviews_submitted into v_carry, v_done from public.tutor_stats where tutor_id = p_tutor for update;
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

  -- 0043: 처음 3문항(이번 제출 전 제출 수 0·1·2)은 +1P 더
  if p_reason = 'review_primary' and coalesce(v_done, 0) < 3 then
    insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
    values (p_tutor, 1, 'first_bonus', p_exam, p_label);
    update public.tutor_stats set points_balance = points_balance + 1 where tutor_id = p_tutor;
    v_points := v_points + 1;
  end if;

  -- 0046: 친구 초대 보너스 — 초대받아 가입한 선생님이 3번째 문항을 제출하면 두 사람 모두 +3P(한 번만)
  if p_reason = 'review_primary' and coalesce(v_done, 0) = 2 then
    select r.inviter_id into v_inviter
      from public.tutor_referrals r
      join public.profiles p on p.id = r.inviter_id and p.role = 'tutor'
     where r.invitee_id = p_tutor and r.rewarded_at is null
     for update of r;
    if v_inviter is not null then
      update public.tutor_referrals set rewarded_at = now() where invitee_id = p_tutor;
      insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_exam_id, ref_item_label)
      values (p_tutor, 3, 'referral_bonus', null, null), (v_inviter, 3, 'referral_bonus', null, null);
      update public.tutor_stats set points_balance = points_balance + 3 where tutor_id in (p_tutor, v_inviter);
      v_points := v_points + 3;
    end if;
  end if;
  return v_points;
end;
$$;
revoke all on function public.award_review_points(uuid, numeric, text, uuid, text) from public, anon, authenticated;

-- 확인용(한 줄): 표=2, 사유_추가=true, 코드_함수=1, 가입_트리거=1, 적립_반영=true
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tutor_invite_codes', 'tutor_referrals')) as 표,
  (position('referral_bonus' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tutor_points_ledger_reason_check')) > 0) as 사유_추가,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tutor_my_invite_code') as 코드_함수,
  (select count(*) from pg_trigger where tgname = 'on_auth_user_referral') as 가입_트리거,
  (position('referral_bonus' in (select prosrc from pg_proc where proname = 'award_review_points')) > 0) as 적립_반영;
