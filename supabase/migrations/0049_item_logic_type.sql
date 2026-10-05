-- 0049 (2026-10-05 원장님 "같은 논리 유형으로 묶인 문제들 중에서도 난이도를 나눠서, 어떤 시험을 틀렸으면 그 시험의
-- 유사문제도 학습할 수 있게"): 문항마다 "논리 유형"(단원이 아니라 풀 때 쓰는 논리)을 적는 칸.
-- 값은 "과목.코드"(예: c2.D1 = 공통수학2 · 접할 조건 거리=반지름). 유형 이름·설명은 lib/similar/logicTypes.ts.
-- 학생 오답 유사문제 화면(/r/<제출 id>)이 같은 유형에서 난이도 한 단계 쉬운 것·같은 것·한 단계 어려운 것을 고른다.
-- 읽기·쓰기는 지금처럼 item_explanations의 RLS를 따르고, 학생 화면은 서버(서비스롤)에서만 읽는다.
alter table public.item_explanations add column if not exists logic_type text
  check (logic_type is null or logic_type ~ '^[a-z][a-z0-9]{1,3}\.[A-Z][A-Z0-9]{0,3}$');
create index if not exists item_explanations_logic_type_idx on public.item_explanations (logic_type) where logic_type is not null;
comment on column public.item_explanations.logic_type is '논리 유형(과목.코드, 예 c2.D1) — lib/similar/logicTypes.ts';

-- 확인: select logic_type, count(*) from item_explanations group by 1 order by 2 desc;
