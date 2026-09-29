-- 0035 — 관리자 계정은 과(의대 등) 표시를 뺀다 (2026-09-29 원장님 요청)
-- 0034에서 모든 계정을 '의대'로 채웠는데, 관리자(원장님 등)는 과를 두지 않는다. 여러 번 실행해도 안전하다.

update public.profiles set department = null where role = 'admin';

-- 확인용: 권한별 과(관리자는 비어 있어야 함)
select role as 권한, coalesce(department, '(없음)') as 과, count(*) as 계정_수
from public.profiles
group by role, department
order by role, department;
