-- 과외선생님 검토 화면에서 "원본 쪽 전체"가 아니라 "그 문항이 인쇄된 부분만" 잘라서 보여주기 위해,
-- 추출 단계에서 AI가 판단한 문항 영역 좌표(0006의 source_page와 같은 문항, 그 쪽 안에서의 위치)를
-- item_explanations에 같이 저장해 둔다. 쪽을 가로 1000 × 세로 1000 칸으로 나눈 좌표계이며
-- (lib/ai/prompts.ts의 QuestionMeta.bbox, DG_TOOL.figures와 같은 규칙), 4개 값이 모두 있어야
-- 화면에서 잘라 보여줄 수 있으므로 전부 채워지거나 전부 비어 있어야 한다.
--
-- source_page와 마찬가지로 새로 처리(재처리 포함)되는 시험부터 채워지고, 이미 끝난 기존 시험이나
-- AI가 영역을 짚지 못한 문항은 null로 남는다 — 화면 쪽에서는 null이면 전체 쪽 보기로 대체한다.

alter table public.item_explanations
  add column bbox_x0 int,
  add column bbox_y0 int,
  add column bbox_x1 int,
  add column bbox_y1 int;

alter table public.item_explanations
  add constraint item_explanations_bbox_check check (
    (bbox_x0 is null and bbox_y0 is null and bbox_x1 is null and bbox_y1 is null)
    or (
      bbox_x0 is not null and bbox_y0 is not null and bbox_x1 is not null and bbox_y1 is not null
      and bbox_x0 >= 0 and bbox_y0 >= 0 and bbox_x1 <= 1000 and bbox_y1 <= 1000
      and bbox_x1 > bbox_x0 and bbox_y1 > bbox_y0
    )
  );

comment on column public.item_explanations.bbox_x0 is
  'AI가 추출 단계에서 판단한, 이 문항 전체(문제 글·그림·선택지 포함)가 인쇄된 사각형 영역의 왼쪽
   위 x좌표. source_page 쪽을 가로 1000칸으로 나눈 값. 4개 좌표(x0,y0,x1,y1)가 모두 있어야
   유효하며, 모르면 전부 null(과외선생님 검토 화면에서 전체 쪽 보기로 대체).';
