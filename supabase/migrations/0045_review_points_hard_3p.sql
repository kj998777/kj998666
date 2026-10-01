-- 0045 검토 적립 포인트: 난이도 '상' 문항 2P → 3P (2026-10-01 원장님 요청)
--   배정될 수 있는 문항 55개 중 상 26·중상 18 — 검토로 넘어오는 문항 대부분이 어려운 문항이라 '상'의 값을 올린다.
--   하·중하·중 1P, 중상 2P, 상 3P. 최초 제출·사후 판정·정답 아는 문항 모두 이 함수를 쓴다(등급 배율·처음 3문항 보너스는 그대로).
--   이미 적립된 포인트는 바꾸지 않는다. 화면 규칙은 lib/tutor/points.ts. 여러 번 실행해도 안전하다. 0044 다음에 실행.

create or replace function public.review_points_for_item(p_item_explanation_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case ie.difficulty when '상' then 3 when '중상' then 2 else 1 end
       from public.item_explanations ie
      where ie.id = p_item_explanation_id),
    1);
$$;
revoke execute on function public.review_points_for_item(uuid) from public, anon;
grant execute on function public.review_points_for_item(uuid) to authenticated;

-- 확인용(한 줄): 상=3, 중상=2, 중=1
select
  (select public.review_points_for_item(id) from public.item_explanations where difficulty = '상' limit 1) as 상,
  (select public.review_points_for_item(id) from public.item_explanations where difficulty = '중상' limit 1) as 중상,
  (select public.review_points_for_item(id) from public.item_explanations where difficulty = '중' limit 1) as 중;
