-- 2026-10-08 원장님: "메딕차트 최적화". 자주 걸러 읽는 칸에 색인(index)을 단다.
-- Postgres는 다른 표를 가리키는 칸(외래 키)에 색인을 저절로 만들지 않아서, 아래 칸들은 지금까지
-- 읽을 때마다 표 전체를 훑었다. 특히 과외선생님 화면마다 도는 "내가 맡은 문항" 확인(lib/tutor/claims.ts)과
-- 과외선생님이 문항을 볼 때 행마다 도는 보안 규칙(item_explanations_select_tutor_claimed, 0004)이
-- tutor_item_reviews 를 item_explanation_id 로 찾는다.
-- 데이터·동작은 바뀌지 않고 읽기만 빨라진다. 여러 번 실행해도 안전하다(if not exists).
-- Supabase SQL Editor 에 그대로 붙여 넣어 한 번 실행하면 된다.

-- 과외선생님 제출 기록
create index if not exists tutor_item_reviews_item_kind_idx
  on public.tutor_item_reviews (item_explanation_id, kind);
create index if not exists tutor_item_reviews_exam_idx
  on public.tutor_item_reviews (exam_id);
create index if not exists tutor_item_reviews_tutor_created_idx
  on public.tutor_item_reviews (tutor_id, created_at desc);
create index if not exists tutor_item_reviews_created_idx
  on public.tutor_item_reviews (created_at);
create index if not exists tutor_item_reviews_verify_claimed_idx
  on public.tutor_item_reviews (verify_claimed_by) where verify_claimed_by is not null;

-- 문항: 과외선생님이 맡은 문항 찾기
create index if not exists item_explanations_claimed_by_idx
  on public.item_explanations (claimed_by) where claimed_by is not null;

-- 포인트 내역: 과외선생님 대시보드(내 내역 최근 순), 운영 화면 기간 합계
create index if not exists tutor_points_ledger_tutor_created_idx
  on public.tutor_points_ledger (tutor_id, created_at desc);
create index if not exists tutor_points_ledger_created_idx
  on public.tutor_points_ledger (created_at);

-- 채점 결과: 정답을 고치면 그 시험의 채점을 다시 읽는다(lib/review/regrade.ts)
create index if not exists grading_results_exam_idx
  on public.grading_results (exam_id);

-- 정답 확인 문항 시도: 문항별로 찾기(기존 고유 색인은 tutor_id 가 앞이라 이 경우엔 못 씀)
create index if not exists tutor_gold_attempts_item_idx
  on public.tutor_gold_attempts (item_explanation_id);
