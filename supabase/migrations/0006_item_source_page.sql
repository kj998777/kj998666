-- 과외선생님 검토 화면에서 AI가 요약한 문장 대신 "원본 문제를 찍은 스크린샷"을 보여주기 위해,
-- 추출 단계에서 AI가 이미 판단해 두는 문항의 인쇄 쪽 번호(1부터)를 item_explanations에 같이
-- 저장해 둔다. 이 값이 있으면 화면에서 원본 PDF의 그 쪽만 이미지로 렌더링해서 보여줄 수 있다.
--
-- 이 값은 새로 처리(재처리 포함)되는 시험부터 채워지고, 이미 끝난 기존 시험은 null로 남는다
-- (다시 처리하지 않는 한 소급 적용되지 않음) — 화면 쪽에서는 null이면 원본 PDF 전체보기 링크로만
-- 안내한다.

alter table public.item_explanations add column source_page int;

comment on column public.item_explanations.source_page is
  'AI가 추출 단계에서 판단한, 이 문항이 인쇄된 시험지 쪽 번호(1부터). 모르면 null.
   과외선생님 검토 화면에서 원본 PDF의 해당 쪽만 이미지로 보여주는 데 쓴다(lib/ai/prompts.ts의
   QuestionMeta.page 참고 — AI 추출 단계에서만 알 수 있고 이후엔 버려지던 값을 여기 보존한다).';
