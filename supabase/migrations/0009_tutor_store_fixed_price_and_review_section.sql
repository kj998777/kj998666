-- #108: 과외선생님 기출 다운로드 가격을 시험마다 다르게 매기던 방식을 없애고, "닫힘" 상태가 되는
--       시험은 전부 고정 3포인트로 자동 판매 대상이 되도록 한다.
-- #110: 이미 "닫힘" 상태인, 아직 판매 대상이 아니던(tutor_download_cost is null) 기존 시험도
--       지금 이 순간 소급 적용해서 판매 대상으로 전환한다(가격 3포인트).
-- #111: 스토어에 "검토 대기중" 구역을 신설할 수 있도록, 과외선생님이 지금 AI 검토가 진행 중인
--       시험의 이름/코드 정도는 볼 수 있게 RLS를 추가한다(구매·다운로드는 여전히 불가 — 실제
--       문항 내용·PDF·정답은 이 정책으로 전혀 노출되지 않음. 시험 이름/코드는 민감정보가 아님).

-- -------------------------------------------------------------------------
-- 1. 기존 "닫힘" 시험 전부 소급 판매 개시 + 가격 3포인트로 통일
--    (관리자가 예전에 다른 값을 넣어둔 경우도 이번 정책 변경으로 3포인트에 맞춘다)
-- -------------------------------------------------------------------------
update public.exams set tutor_download_cost = 3 where status = '닫힘';

-- -------------------------------------------------------------------------
-- 2. 앞으로 시험이 "닫힘"으로 바뀌는(또는 처음부터 닫힘으로 생성되는) 순간 자동으로 3포인트
--    판매 대상이 되도록 트리거로 강제한다 — 관리자가 더 이상 개별 지정할 필요가 없다.
--    단, 관리자가 나중에 특정 시험을 일부러 판매 대상에서 뺐다면(tutor_download_cost를 다시
--    null로 지정) 그 시험이 계속 "닫힘" 상태로 다른 열을 수정할 때마다 이 트리거가 되살려 버리면
--    안 되므로, "닫힘으로 막 전환되는 순간"이거나 "아직 한 번도 값이 없던" 경우에만 3으로 채운다.
-- -------------------------------------------------------------------------
create or replace function public.auto_set_tutor_download_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = '닫힘'
     and (tg_op = 'INSERT' or old.status is distinct from '닫힘')
     and new.tutor_download_cost is null
  then
    new.tutor_download_cost := 3;
  end if;
  return new;
end;
$$;

comment on function public.auto_set_tutor_download_cost() is
  '#108/#110: 시험이 닫힘 상태로 전환되면 고정 3포인트로 자동 판매 대상이 된다(관리자가 그 뒤
   일부러 null로 빼면 그대로 유지 — 이 트리거는 "막 닫힌 순간"에만 개입한다).';

drop trigger if exists exams_before_change_tutor_cost on public.exams;
create trigger exams_before_change_tutor_cost
  before insert or update on public.exams
  for each row execute function public.auto_set_tutor_download_cost();

-- -------------------------------------------------------------------------
-- 3. #111 — 검토 대기중(검수대기) 시험을 과외선생님이 볼 수 있게 하는 RLS.
--    exams_select_tutor_store와는 별개의 추가 정책(OR로 합쳐짐) — 구매/판매 여부와 무관하게
--    "지금 검토가 진행 중인 시험이 있다"만 보여준다.
-- -------------------------------------------------------------------------
drop policy if exists "exams_select_tutor_in_review" on public.exams;
create policy "exams_select_tutor_in_review"
  on public.exams for select to authenticated
  using (public.is_tutor() and status = '검수대기');
