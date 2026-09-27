-- 버그 수정: "포기하고 다른 문항 받기"를 눌러도 계속 같은 문항이 다시 배정되던 문제.
--
-- claim_next_review_item()은 새 문항을 배정할 때 item_explanations 중 updated_at이 가장
-- 오래된(order by ie.updated_at limit 1) 미검토 문항을 고른다. 그런데 release_review_claim()은
-- 클레임(claimed_by/claim_expires_at)만 풀어 줄 뿐 updated_at은 그대로 두므로, 방금 "포기"한
-- 문항이 여전히 큐에서 가장 오래된 문항으로 남아 있어 바로 다음 배정에서 똑같이 다시 뽑혔다
-- (포기해도 계속 같은 문항만 나오는 원인).
--
-- 포기할 때 item_explanations.updated_at을 지금 시각으로 갱신해 큐 맨 뒤로 보내면, 다음 배정
-- 때는 다른(더 오래 기다린) 문항이 먼저 나가고, 이 문항은 다른 문항들이 다 지나간 뒤에야 다시
-- 배정된다 — 검토 큐가 실제로 "다음 문항"으로 넘어가게 된다.

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
    set claimed_by = null, claim_expires_at = null, updated_at = now()
  where id = p_item_explanation_id and claimed_by = auth.uid();

  update public.tutor_item_reviews
    set verify_claimed_by = null, verify_claim_expires_at = null
  where item_explanation_id = p_item_explanation_id and kind = 'primary' and verify_claimed_by = auth.uid();
end;
$$;

grant execute on function public.release_review_claim(uuid) to authenticated;
