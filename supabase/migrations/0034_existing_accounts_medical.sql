-- 0034 — 지금까지 등록된 모든 계정(대기 포함)의 과를 '의대'로 (2026-09-29 원장님 요청)
--
-- 0033에서 회원가입 때 과(의대·수의대·약대·간호대)를 고르게 됐는데, 그 전에 가입한 계정은 과가 비어 있다.
-- 지금까지 가입한 사람은 모두 의대이므로 비어 있는 과를 '의대'로 채운다(이미 과가 있는 계정은 그대로).
-- 0033을 아직 안 돌렸어도 되도록 열을 먼저 만든다(0033의 검사 조건과 충돌하지 않음). 여러 번 실행해도 안전하다.

alter table public.profiles add column if not exists department text;

update public.profiles set department = '의대' where department is null;

-- 확인용: 과별 계정 수(권한별) — 전부 의대면 성공
select coalesce(department, '(비어 있음)') as 과, role as 권한, count(*) as 계정_수
from public.profiles
group by department, role
order by department, role;
