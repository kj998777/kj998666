-- #115: 관리자 계정에서 과외선생님 계정 하나를 골라 포인트를 임의로(양수/음수) 지급/차감할 수 있게
--       한다. 원장님 요청: "테스트를 해봐야 할 것 같아서" — 실제 검토/구매 흐름을 거치지 않고도
--       포인트 잔액을 자유롭게 바꿔서 스토어 구매 등 다른 기능을 테스트할 수 있도록 하는 관리 도구.
--
-- 설계 메모:
--   - tutor_points_ledger.reason 체크 제약에는 이미 0004에서 'admin_adjustment' 값이 포함돼 있었지만
--     지금까지 실제로 이 reason으로 insert하는 RPC가 없었다. 이번에 처음 사용한다.
--   - delta는 양수(지급)/음수(차감) 모두 허용하되, 0은 의미가 없으므로 막는다.
--   - 차감 요청으로 잔액이 음수가 되는 것은 막는다(다른 모든 포인트 차감 경로 — purchase_exam_download —
--     와 동일하게 "잔액 부족" 규칙을 지킨다). 필요하면 나중에 강제로 음수까지 허용하는 옵션을 추가할
--     수 있지만, 지금은 요청받지 않았으므로 넣지 않는다.
--   - 대상 계정이 반드시 role='tutor'인지 확인한다 — admin/editor/viewer 계정에는 애초에 tutor_stats
--     행이 없으므로 자연히 막히지만, 에러 메시지를 명확히 하기 위해 명시적으로 체크한다.
--   - 메모(note)는 별도 컬럼이 없는 tutor_points_ledger.ref_item_label을 재사용한다(다른 reason에서는
--     문항 라벨을 담는 칸이지만, admin_adjustment 행에서는 "관리자가 남긴 메모"라는 의미로 쓴다).
--   - 에러 코드는 기존에 쓰인 P0010~P0040과 겹치지 않도록 P0050번대를 새로 쓴다.

create or replace function public.admin_adjust_tutor_points(
  p_tutor_id uuid,
  p_delta int,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_balance int;
  v_new_balance int;
begin
  if not public.is_admin() then
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
$$;

grant execute on function public.admin_adjust_tutor_points(uuid, int, text) to authenticated;
