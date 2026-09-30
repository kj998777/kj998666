-- 0040 — 보안·권한 점검에서 찾은 구멍 막기 (2026-09-30 밤, Claude 자율 점검)
--
-- 로컬 PostgreSQL에 Supabase와 같은 기본 권한(anon·authenticated가 모든 표·함수에 접근 가능, 막는 건 RLS뿐)을 재현하고
-- 0001~0039를 차례로 적용한 뒤, 역할(비로그인·관리자·편집자·뷰어·과외선생님 둘·대기)마다 모든 표를 읽기·고치기·지우기·넣기
-- 해 보고, SECURITY DEFINER 함수를 전부 훑었다. 표 권한(RLS)에서는 새는 곳이 없었고, 함수 쪽을 고친다(5번이 가장 중요).
--   1) 옛 claim_verification_item(): 과외선생님 확인이 없어 대기 계정·직원도 사후검증 문항을 30분씩 잡아 둘 수 있었음 → 실행 권한 회수
--      (지금 배정은 claim_next_review_item → claim_verification_item_ex를 쓰고, 이 옛 함수는 쓰지 않는다)
--   2) tutor_accuracy · tutor_trust_level · tutor_point_ranking: auth.uid()가 없으면 "서버 호출"로 보고 통과시켰는데, 로그인 안 한
--      사람(anon 키)도 auth.uid()가 없어서 선생님 id만 알면 정답률·등급을, 그리고 랭킹(가린 이름)을 볼 수 있었음 → anon 거절.
--      운영 현황(서비스롤 호출)에서 랭킹 이름이 가려져 보이던 것도 함께 바로잡음(서비스롤 = 관리자 보기).
--   3) resolve_tutor_verification: 판정한 선생님이 나중에 직접 불러 일치 여부를 뒤집을 수 있었음 → 처음 정한 값과 같을 때만
--   4) 수정 요청(이의제기) 규칙(근거 10자·하루 3건·거절 누적·같은 문항 중복)을 DB 트리거로도 강제
-- 여러 번 실행해도 안전하다. 0039 다음에 실행.

-- 1)
revoke all on function public.claim_verification_item() from public, anon, authenticated;

-- 2)
CREATE OR REPLACE FUNCTION public.tutor_accuracy(p_tutor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reset timestamptz;
  v_judged int;
  v_correct int;
begin
  -- 0040: 로그인 안 한 사람(anon)은 못 본다. 서버(서비스롤)·SQL 편집기처럼 사용자 없는 호출만 auth.uid() 없이 통과
  if auth.uid() is null and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    return null;
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.tutor_trust_level(p_tutor uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paused boolean;
  v_reset timestamptz;
  v_done int;
  v_judged int;
  v_correct int;
  v_acc numeric;
begin
  -- 본인·관리자·서버(서비스롤, auth.uid() 없음)만 조회
  -- 0040: 로그인 안 한 사람(anon)은 못 본다. 서버(서비스롤)·SQL 편집기처럼 사용자 없는 호출만 auth.uid() 없이 통과
  if auth.uid() is null and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    return null;
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.tutor_point_ranking(p_period text DEFAULT 'all'::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_from timestamptz;
  -- 0040: 관리자 화면(운영 현황)은 서비스롤로 부르므로 그때도 이름을 그대로
  v_admin boolean := coalesce(public.is_admin(), false) or coalesce(auth.role(), '') = 'service_role';
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_mine jsonb;
begin
  -- 0040: 로그인 안 한 사람(anon)은 못 본다(전에는 auth.uid()가 없으면 통과)
  -- (is_tutor()는 비로그인이면 NULL이라 coalesce 필요 — 전에는 NULL 때문에 이 검사가 통째로 통과됐다)
  if not (v_admin or coalesce(public.is_tutor(), false) or (v_me is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))) then
    return null;
  end if;
  select started_at into v_start from public.tutor_ranking_settings where id;
  v_start := coalesce(v_start, now());
  if p_period = 'month' then
    v_from := greatest(v_start, (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul');
  else
    v_from := v_start;
  end if;

  with pts as (
    select l.tutor_id, sum(l.delta)::int as points
    from public.tutor_points_ledger l
    where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from
    group by l.tutor_id
  ),
  ranked as (
    select p.tutor_id, p.points, rank() over (order by p.points desc) as rnk,
           pr.display_name, pr.cohort, pr.department, pr.email
    from pts p join public.profiles pr on pr.id = p.tutor_id
    where pr.role = 'tutor'
  ),
  labeled as (
    select r.*,
      case
        when v_admin or r.tutor_id = v_me then
          trim(concat_ws(' ', nullif(case when r.department is not null and r.department <> '의대' then r.department end, ''), r.cohort, coalesce(nullif(r.display_name, ''), case when v_admin then r.email end, '선생님')))
        else
          trim(concat_ws(' ', r.cohort,
            case when coalesce(r.display_name, '') = '' then '선생님'
                 else left(r.display_name, 1) || repeat('○', greatest(char_length(r.display_name) - 1, 1)) end))
      end as label
    from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', rnk, 'points', points, 'label', label, 'me', tutor_id = v_me) order by rnk, label), '[]'::jsonb)
    into v_rows
  from (select * from labeled order by rnk, label limit greatest(1, least(p_limit, 200))) x;

  select jsonb_build_object('rank', rnk, 'points', points)
    into v_mine
  from (
    select p.tutor_id, p.points, rank() over (order by p.points desc) as rnk
    from (select l.tutor_id, sum(l.delta)::int as points from public.tutor_points_ledger l
           where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from
           group by l.tutor_id) p
    join public.profiles pr on pr.id = p.tutor_id and pr.role = 'tutor'
  ) z where z.tutor_id = v_me;

  return jsonb_build_object('startedAt', v_start, 'from', v_from, 'rows', v_rows, 'mine', v_mine,
    'total', (select count(distinct l.tutor_id) from public.tutor_points_ledger l join public.profiles pr on pr.id = l.tutor_id and pr.role = 'tutor'
               where l.reason in ('review_primary', 'review_verify') and l.delta > 0 and l.created_at >= v_from));
end;
$function$;

-- 3) resolve_tutor_verification
CREATE OR REPLACE FUNCTION public.resolve_tutor_verification(p_verify_review_id uuid, p_is_match boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_id uuid;
begin
  update public.tutor_item_reviews
    set is_match = p_is_match
  where id = p_verify_review_id and kind = 'verify' and tutor_id = auth.uid()
    and (is_match is null or is_match = p_is_match) -- 0040: 한 번 정한 일치 여부를 본인이 나중에 뒤집지 못하게
  returning matches_primary_review_id into v_primary_id;
  if v_primary_id is null then
    raise exception '검증 기록을 찾을 수 없습니다.' using errcode = 'P0038';
  end if;
  update public.tutor_item_reviews set resolved = p_is_match where id = v_primary_id;
end;
$function$;

-- 4) 수정 요청(이의제기) 규칙을 DB에서도 강제(전에는 화면·서버 코드에서만 확인해, 과외선생님 세션으로 표에 직접 넣으면
--    근거 없는 정답 변경 요청·하루 3건 제한·거절 누적 제한을 건너뛸 수 있었음). 관리자·서버(서비스롤)는 그대로.
create or replace function public.enforce_tutor_edit_request_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
  v_today int;
  v_rejected int;
begin
  if not coalesce(public.is_tutor(), false) then
    return new;
  end if;
  if coalesce(btrim(new.proposed_answer), '') <> ''
     and char_length(coalesce(btrim(new.proposed_solution), '')) < 10
     and char_length(coalesce(btrim(new.note), '')) < 10 then
    raise exception '정답을 바꾸자는 요청은 근거가 필요해요. 풀이나 메모에 10자 이상 적어 주세요.' using errcode = 'P0060';
  end if;
  select count(*) into v_today from public.tutor_edit_requests where tutor_id = new.tutor_id and created_at >= v_day_start;
  if v_today >= 3 then
    raise exception '수정 요청은 하루 3건까지 보낼 수 있어요.' using errcode = 'P0061';
  end if;
  select count(*) into v_rejected from public.tutor_edit_requests
   where tutor_id = new.tutor_id and status = 'rejected' and resolved_at >= now() - interval '30 days';
  if v_rejected >= 3 then
    raise exception '최근 30일 동안 반영되지 않은 요청이 3건 이상이라 잠시 요청을 보낼 수 없어요.' using errcode = 'P0062';
  end if;
  if exists (select 1 from public.tutor_edit_requests
              where tutor_id = new.tutor_id and exam_id = new.exam_id and item_label = new.item_label and status = 'pending') then
    raise exception '이 문항에 이미 확인을 기다리는 요청이 있습니다.' using errcode = 'P0063';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_tutor_edit_request_rules on public.tutor_edit_requests;
create trigger trg_enforce_tutor_edit_request_rules
  before insert on public.tutor_edit_requests
  for each row execute function public.enforce_tutor_edit_request_rules();


-- 5) 가장 중요한 구멍: is_admin()·is_tutor()는 로그인 안 한 사람(anon)에게 false가 아니라 NULL을 돌려준다. 그래서
--    "if not public.is_admin() then 거절" 같은 검사가 NULL이 되어 통째로 건너뛰어졌다. 로컬 재현 결과 비로그인(anon 키,
--    사이트 화면 코드에 들어 있는 공개 키)으로 admin_adjust_tutor_points를 불러 아무 선생님에게나 포인트를 줄 수 있었다.
--    (표 권한 RLS는 NULL을 거절로 보기 때문에 표 쪽은 안전했음. 함수 안의 if 검사만 문제)
--    → 사용자 세션으로만 부르는 함수들의 검사를 coalesce(..., false)로 바꾼다. 서비스롤이 NULL 통과에 기대는
--    enforce_exam_status_change_admin_only(시험 자동 열기)와 auth.uid()를 먼저 확인하는 정답률·등급 함수는 그대로 둔다.
CREATE OR REPLACE FUNCTION public.admin_adjust_tutor_points(p_tutor_id uuid, p_delta integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_balance int;
  v_new_balance int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception '관리자 계정만 포인트를 조정할 수 있습니다.' using errcode = 'P0050';
  end if;

  if p_delta = 0 or p_delta is null then
    raise exception '0이 아닌 조정값을 입력해 주세요.' using errcode = 'P0051';
  end if;

  if p_note is not null and char_length(p_note) > 200 then
    raise exception '메모가 너무 깁니다(200자 이하).' using errcode = 'P0052';
  end if;

  select role into v_role from public.profiles where id = p_tutor_id;
  if v_role is null then
    raise exception '대상 계정을 찾을 수 없습니다.' using errcode = 'P0053';
  end if;
  if v_role <> 'tutor' then
    raise exception '과외선생님 계정만 포인트를 조정할 수 있습니다.' using errcode = 'P0053';
  end if;

  select points_balance into v_balance
  from public.tutor_stats
  where tutor_id = p_tutor_id
  for update;

  if v_balance is null then
    raise exception '이 계정의 포인트 정보를 찾을 수 없습니다.' using errcode = 'P0054';
  end if;

  v_new_balance := v_balance + p_delta;
  if v_new_balance < 0 then
    raise exception '차감 후 잔액이 음수가 될 수 없습니다(현재 잔액: %).', v_balance using errcode = 'P0055';
  end if;

  update public.tutor_stats
    set points_balance = v_new_balance
  where tutor_id = p_tutor_id;

  insert into public.tutor_points_ledger (tutor_id, delta, reason, ref_item_label)
  values (p_tutor_id, p_delta, 'admin_adjustment', p_note);

  return jsonb_build_object('ok', true, 'previousBalance', v_balance, 'newBalance', v_new_balance);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_approve_with_student_no(p_user_id uuid, p_student_no text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if public.normalize_student_no(p_student_no) is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  r := public.admin_set_student_no(p_user_id, p_student_no);
  if not coalesce((r ->> 'ok')::boolean, false) then
    return r;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_student_no(p_user_id uuid, p_student_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_no text := public.normalize_student_no(p_student_no);
  v_other uuid;
  v_email text;
  v_name text;
  v_cohort text;
  v_dept text;
begin
  if not coalesce(public.is_admin(), false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;
  if v_no is null then
    delete from public.student_numbers where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  if v_no !~ '^[0-9A-Z]{4,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'format');
  end if;
  select user_id into v_other from public.student_numbers where student_no = v_no and user_id <> p_user_id;
  if v_other is not null then
    select email, display_name, cohort, department into v_email, v_name, v_cohort, v_dept from public.profiles where id = v_other;
    return jsonb_build_object('ok', false, 'reason', 'duplicate', 'other_email', v_email, 'other_name', v_name,
                              'other_cohort', v_cohort, 'other_department', v_dept);
  end if;
  insert into public.student_numbers (user_id, student_no, updated_at, updated_by)
  values (p_user_id, v_no, now(), auth.uid())
  on conflict (user_id) do update set student_no = excluded.student_no, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'duplicate');
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_next_review_item()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_id uuid;
  v_pass boolean;
begin
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.purchase_exam_download(p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cost int;
  v_balance int;
  v_already boolean;
begin
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.release_review_claim(p_item_explanation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary int;
  v_verify int;
begin
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_gold_attempt(p_item_explanation_id uuid, p_answer_display text, p_solution text, p_image_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_exam uuid;
  v_label text;
  v_points int;
begin
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_tutor_review(p_item_explanation_id uuid, p_answer_display text, p_solution text, p_image_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_tutor_verification(p_item_explanation_id uuid, p_answer_display text, p_solution text, p_image_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_id uuid;
  v_primary_tutor uuid;
  v_exam_id uuid;
  v_item_label text;
  v_tiebreak boolean;
  v_verify_id uuid;
  v_points int;
begin
  if not coalesce(public.is_tutor(), false) then
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
$function$;

CREATE OR REPLACE FUNCTION public.tutor_item_access(p_item_explanation_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not coalesce(public.is_tutor(), false) then null
    when exists (select 1 from public.item_explanations ie
                  where ie.id = p_item_explanation_id and ie.claimed_by = auth.uid() and ie.claim_expires_at > now()) then 'primary'
    when exists (select 1 from public.tutor_gold_attempts g
                  where g.item_explanation_id = p_item_explanation_id and g.tutor_id = auth.uid()
                    and g.submitted_at is null and not g.released and g.claim_expires_at > now()) then 'primary'
    when exists (select 1 from public.tutor_item_reviews r
                  where r.item_explanation_id = p_item_explanation_id and r.kind = 'primary'
                    and r.verify_claimed_by = auth.uid() and r.verify_claim_expires_at > now()) then 'verify'
    else null end;
$function$;

-- 6) 덧막기: 로그인 안 한 사람은 쓸 일이 없는 과외·관리자 함수의 실행 권한을 anon에게서 뺀다
--    (is_admin() 같은 도우미는 표 권한 검사에 쓰이므로 건드리지 않는다)
revoke execute on function public.admin_adjust_tutor_points(uuid, integer, text) from public, anon;
revoke execute on function public.claim_next_review_item() from public, anon;
revoke execute on function public.purchase_exam_download(uuid) from public, anon;
revoke execute on function public.release_review_claim(uuid) from public, anon;
revoke execute on function public.submit_gold_attempt(uuid, text, text, text) from public, anon;
revoke execute on function public.submit_tutor_review(uuid, text, text, text) from public, anon;
revoke execute on function public.submit_tutor_verification(uuid, text, text, text) from public, anon;
revoke execute on function public.tutor_item_access(uuid) from public, anon;
revoke execute on function public.resolve_tutor_verification(uuid, boolean) from public, anon;
revoke execute on function public.tutor_accuracy(uuid) from public, anon;
revoke execute on function public.tutor_trust_level(uuid) from public, anon;
revoke execute on function public.tutor_point_ranking(text, integer) from public, anon;
revoke execute on function public.review_points_for_item(uuid) from public, anon;
grant execute on function public.admin_adjust_tutor_points(uuid, integer, text) to authenticated;
grant execute on function public.claim_next_review_item() to authenticated;
grant execute on function public.purchase_exam_download(uuid) to authenticated;
grant execute on function public.release_review_claim(uuid) to authenticated;
grant execute on function public.submit_gold_attempt(uuid, text, text, text) to authenticated;
grant execute on function public.submit_tutor_review(uuid, text, text, text) to authenticated;
grant execute on function public.submit_tutor_verification(uuid, text, text, text) to authenticated;
grant execute on function public.tutor_item_access(uuid) to authenticated;
grant execute on function public.resolve_tutor_verification(uuid, boolean) to authenticated;
grant execute on function public.tutor_accuracy(uuid) to authenticated;
grant execute on function public.tutor_trust_level(uuid) to authenticated;
grant execute on function public.tutor_point_ranking(text, integer) to authenticated;
grant execute on function public.review_points_for_item(uuid) to authenticated;

-- 확인용(한 줄): 옛함수_막음=true, 규칙_트리거=1, 익명_랭킹_막음=true, 익명_포인트조정_막음=true, 널검사_고침=10, 그리고 포인트 조정 기록 수·합계
select
  (not has_function_privilege('authenticated', 'public.claim_verification_item()', 'execute')) as 옛함수_막음,
  (select count(*) from pg_trigger where tgname = 'trg_enforce_tutor_edit_request_rules') as 규칙_트리거,
  (position('coalesce(public.is_tutor(), false)' in (select prosrc from pg_proc where proname = 'tutor_point_ranking')) > 0) as 익명_랭킹_막음,
  (not has_function_privilege('anon', 'public.admin_adjust_tutor_points(uuid, integer, text)', 'execute')) as 익명_포인트조정_막음,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('admin_adjust_tutor_points','admin_approve_with_student_no','admin_set_student_no','claim_next_review_item','purchase_exam_download',
                     'release_review_claim','submit_gold_attempt','submit_tutor_review','submit_tutor_verification','tutor_item_access')
     and prosrc ~ 'coalesce\(public\.is_(admin|tutor)\(\), false\)') as 널검사_고침,
  -- 혹시 누가 이미 써먹었는지: 관리자 포인트 조정 기록 수·합계(가입 환영 3P + 원장님이 직접 준 것 말고 더 있으면 알려 주세요)
  (select count(*) from public.tutor_points_ledger where reason = 'admin_adjustment') as 포인트조정_기록수,
  (select coalesce(sum(delta), 0) from public.tutor_points_ledger where reason = 'admin_adjustment') as 포인트조정_합계;
