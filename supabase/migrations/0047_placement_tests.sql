-- 0047 입학테스트(2026-10-01 원장님 요청: "입학테스트 문제 10문제 정도 만드는 기능")
--   문항 은행(검토 끝난 기출)에서 학년·과목 범위로 10문항 안팎을 자동으로 골라 입학테스트를 만든다(고르기는 앱 — lib/placement/pick.ts).
--   학생은 /p/<코드> (시험지 마지막 쪽 QR)로 답을 내고, 바로 채점돼 진단 보고서(단원·난이도별, 추천 수업 단계)를 만든다.
--   1) placement_tests: 만든 테스트(문항 id 목록·배점·코드). 원장님·편집자가 만든 것(staff)은 직원 모두가, 과외선생님이 만든 것(tutor)은
--      본인·관리자만 본다. 쓰기는 아래 함수만.
--   2) placement_submissions: 학생 제출(이름·답·채점 결과). 같은 테스트에 같은 이름은 한 번. 넣기는 서버(서비스롤)만 — 채점을 서버가 하므로.
--   3) create_placement_test(문항 id들, 제목, 범위 이름): 편집자·관리자는 무료(정답 확정된 문항이면 무엇이든),
--      과외선생님은 2P(기출 스토어 시험 문항만, 사유 placement_purchase) — 받은 문항은 tutor_worksheet_items에 넣어 정답 아는 문항 배정에서 뺀다.
--      배점은 합 100점(나누어떨어지지 않으면 뒤쪽 문항에 1점씩 더 — lib/placement/pick.ts pointsFor와 같은 셈).
--   4) set_placement_open(id, 열기/닫기): 만든 사람·관리자만.
-- 여러 번 실행해도 안전하다. 0046 다음에 실행.

create table if not exists public.placement_tests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^P[A-Z0-9]{6}$'),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  owner_kind text not null check (owner_kind in ('staff', 'tutor')),
  title text not null default '' check (char_length(title) <= 60),
  scope_label text not null default '' check (char_length(scope_label) <= 40),
  item_ids uuid[] not null check (cardinality(item_ids) between 1 and 20),
  points int[] not null,
  points_spent int not null default 0 check (points_spent >= 0),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  check (cardinality(points) = cardinality(item_ids))
);
create index if not exists placement_tests_owner_idx on public.placement_tests (owner_id, created_at desc);
alter table public.placement_tests enable row level security;
drop policy if exists "placement_tests_select" on public.placement_tests;
create policy "placement_tests_select" on public.placement_tests for select to authenticated
  using (owner_id = auth.uid() or coalesce(public.is_admin(), false) or (owner_kind = 'staff' and coalesce(public.is_staff(), false)));
revoke all on public.placement_tests from anon;
revoke insert, update, delete on public.placement_tests from authenticated;
grant select on public.placement_tests to authenticated;

create table if not exists public.placement_submissions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.placement_tests (id) on delete cascade,
  student_name text not null check (char_length(student_name) between 1 and 30),
  answers jsonb not null default '[]',
  per_item jsonb not null default '[]',
  total_score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (test_id, student_name)
);
create index if not exists placement_submissions_test_idx on public.placement_submissions (test_id, created_at desc);
alter table public.placement_submissions enable row level security;
drop policy if exists "placement_submissions_select" on public.placement_submissions;
create policy "placement_submissions_select" on public.placement_submissions for select to authenticated
  using (exists (
    select 1 from public.placement_tests t
    where t.id = test_id
      and (t.owner_id = auth.uid() or coalesce(public.is_admin(), false) or (t.owner_kind = 'staff' and coalesce(public.is_staff(), false)))
  ));
revoke all on public.placement_submissions from anon;
revoke insert, update, delete on public.placement_submissions from authenticated;
grant select on public.placement_submissions to authenticated;

-- 포인트 기록 사유에 placement_purchase 추가(0046까지의 사유는 그대로)
alter table public.tutor_points_ledger drop constraint if exists tutor_points_ledger_reason_check;
alter table public.tutor_points_ledger add constraint tutor_points_ledger_reason_check
  check (reason in ('review_primary', 'review_verify', 'download_purchase', 'admin_adjustment', 'dispute_reward', 'worksheet_purchase',
                    'first_bonus', 'referral_bonus', 'placement_purchase'));

create or replace function public.create_placement_test(p_item_ids uuid[], p_title text default '', p_scope text default '')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_item_ids), 0);
  v_kind text;
  v_ok int;
  v_cost int := 0;
  v_bal int;
  v_base int;
  v_extra int;
  v_points int[];
  v_code text;
  v_id uuid;
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = 'P0030';
  end if;
  if coalesce(public.is_editor_or_admin(), false) then
    v_kind := 'staff';
  elsif coalesce(public.is_tutor(), false) then
    v_kind := 'tutor';
    v_cost := 2; -- lib/placement/pick.ts TUTOR_PLACEMENT_COST와 같이
  else
    raise exception '입학테스트는 편집자·관리자·과외선생님만 만들 수 있습니다.' using errcode = 'P0030';
  end if;
  if v_n < 1 or v_n > 20 then
    raise exception '문항은 1~20개까지 넣을 수 있습니다.' using errcode = 'P0047';
  end if;
  if (select count(distinct x) from unnest(p_item_ids) x) <> v_n then
    raise exception '같은 문항이 두 번 들어 있습니다.' using errcode = 'P0047';
  end if;

  -- 정답이 확정되고 정답표에 정답이 있는 문항만. 과외선생님은 기출 스토어 시험의 문항만.
  select count(*) into v_ok
  from public.item_explanations ie
  join public.exams e on e.id = ie.exam_id
  join public.answer_key k on k.exam_id = ie.exam_id and k.item_label = ie.item_label
  where ie.id = any(p_item_ids)
    and coalesce(k.correct_answers, '') <> ''
    and (ie.review_confirmed or e.status <> '검수대기')
    and (v_kind = 'staff' or (e.status <> '검수대기' and e.tutor_download_cost is not null));
  if v_ok <> v_n then
    raise exception '넣을 수 없는 문항이 섞여 있습니다(정답이 확정되지 않았거나 고를 수 없는 시험). 새로 뽑아 주세요.' using errcode = 'P0047';
  end if;

  if v_cost > 0 then
    select points_balance into v_bal from public.tutor_stats where tutor_id = v_uid for update;
    if coalesce(v_bal, 0) < v_cost then
      raise exception '포인트가 부족합니다(필요 %P, 보유 %P).', v_cost, coalesce(v_bal, 0) using errcode = 'P0040';
    end if;
  end if;

  v_base := 100 / v_n;
  v_extra := 100 - v_base * v_n;
  select array_agg(v_base + case when i > v_n - v_extra then 1 else 0 end order by i) into v_points from generate_series(1, v_n) i;

  loop
    select 'P' || string_agg(substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1), '') into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.placement_tests where code = v_code);
  end loop;

  insert into public.placement_tests (code, owner_id, owner_kind, title, scope_label, item_ids, points, points_spent)
  values (v_code, v_uid, v_kind, left(btrim(coalesce(p_title, '')), 60), left(btrim(coalesce(p_scope, '')), 40), p_item_ids, v_points, v_cost)
  returning id into v_id;

  if v_kind = 'tutor' then
    insert into public.tutor_worksheet_items (tutor_id, item_explanation_id)
    select v_uid, x from unnest(p_item_ids) x
    on conflict do nothing;
    if v_cost > 0 then
      update public.tutor_stats set points_balance = points_balance - v_cost where tutor_id = v_uid;
      insert into public.tutor_points_ledger (tutor_id, delta, reason) values (v_uid, -v_cost, 'placement_purchase');
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'code', v_code, 'cost', v_cost);
end;
$function$;
revoke execute on function public.create_placement_test(uuid[], text, text) from public, anon;
grant execute on function public.create_placement_test(uuid[], text, text) to authenticated;

create or replace function public.set_placement_open(p_id uuid, p_open boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.placement_tests set is_open = coalesce(p_open, false)
  where id = p_id and (owner_id = auth.uid() or coalesce(public.is_admin(), false));
  if not found then
    raise exception '입학테스트를 찾을 수 없습니다.' using errcode = 'P0047';
  end if;
  return coalesce(p_open, false);
end;
$function$;
revoke execute on function public.set_placement_open(uuid, boolean) from public, anon;
grant execute on function public.set_placement_open(uuid, boolean) to authenticated;

-- 확인용(한 줄): 표=2, 사유_추가=true, 함수=2
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('placement_tests', 'placement_submissions')) as 표,
  (position('placement_purchase' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tutor_points_ledger_reason_check')) > 0) as 사유_추가,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_placement_test', 'set_placement_open')) as 함수;
