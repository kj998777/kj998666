-- 2026-09-28 원장님 요청: "모든 열린 시험들 다 기출스토어에 올리기".
--
-- 앞으로 열리는 시험은 0014의 auto_set_tutor_download_cost 트리거가 "열림으로 바뀌는 순간" 자동으로
-- 3포인트에 등록한다. 이 파일은 그 트리거가 생기기 전에 이미 열려 있었거나, 가격이 비어 있는 채로 열려
-- 있는 시험을 한 번에 소급 등록한다(가격은 다른 시험과 같은 고정 3포인트). 이미 가격이 있는 시험은
-- 건드리지 않는다.

update public.exams
set tutor_download_cost = 3
where status = '열림'
  and tutor_download_cost is null;

-- 확인용(실행 후 0이어야 함):
--   select count(*) from public.exams where status = '열림' and tutor_download_cost is null;
