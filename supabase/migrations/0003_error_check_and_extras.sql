-- =========================================================================
-- v2 AI 기능 3종(스캔 디지털화 실제 파이프라인 / QR·정오표 PDF / 출제오류 의심) 추가 스키마.
-- 0002에서 스키마만 만들어 두고 로직은 없던 부분을 실제로 구현하면서 필요해진 열·테이블.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. item_explanations — 출제오류 의심 판단의 근거·AI가 구한 답·확신도를 함께 저장.
--    (exam_error_suspected 불리언은 0002에 이미 있음; 여기서는 화면에 보여줄 상세를 추가)
-- -------------------------------------------------------------------------
alter table public.item_explanations add column exam_error_kind text not null default '';
alter table public.item_explanations add column exam_error_reason text not null default '';
alter table public.item_explanations add column exam_error_student_note text not null default '';

comment on column public.item_explanations.exam_error_kind is
  '출제오류 의심 종류(조건모순/조건부족/정답없음/정답여러개/선택지오류/그림불일치/문장불일치/오탈자/기타). 의심 아니면 빈 문자열.';
comment on column public.item_explanations.exam_error_reason is
  '선생님용 판단 근거(AI가 직접 풀어 본 결과 포함). 학생에게는 보이지 않음.';
comment on column public.item_explanations.exam_error_student_note is
  '학생에게 보여도 되는 한 줄(정답·풀이 언급 금지). 정오표(exam_corrections)와 별개로, 해설 화면에만 표시.';

-- -------------------------------------------------------------------------
-- 2. item_checks — 문항별 "출제오류 의심 AI 판단" 진행 상태.
--    Apps Script '해설재작성' 시트(키 시험코드#문항#eq)에 대응. 문항마다 독립적으로
--    진행되므로(동시에 여러 문항을 검토할 수 있음) exam_jobs와 달리 (exam_id, item_label)이 기본키.
-- -------------------------------------------------------------------------
create table public.item_checks (
  exam_id uuid not null references public.exams (id) on delete cascade,
  item_label text not null,
  stage text not null check (stage in ('rx_submit', 'rx_wait', 'rx_done', 'rx_error')),
  message text not null default '',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (exam_id, item_label)
);

comment on table public.item_checks is
  '문항별 AI 출제오류 의심 점검(submit_error_check) 진행 상태. 비용이 드는 관리자 전용 기능.';

alter table public.item_checks enable row level security;

create policy "item_checks_select_staff"
  on public.item_checks for select to authenticated using (public.is_staff());
create policy "item_checks_write_admin"
  on public.item_checks for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.item_checks to authenticated;
grant insert, update, delete on public.item_checks to authenticated;

-- -------------------------------------------------------------------------
-- 3. exam_pdf_meta — 페이지 수를 서버에서 직접 셀 수 있게 됨(pdf-lib 도입, lib/ai/pdf.ts 참고).
--    is_scanned 판정도 서버에서 함께 한다(브라우저 pdf.js 없이 텍스트 추출 글자 수로 판별).
--    열 자체는 0002에 이미 있으므로 스키마 변경은 없음 — 이 주석은 그 사실을 남겨 두기 위함.
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- 4. digitize_jobs — dg_error에서도 재시도 시 이어서 만들 수 있도록 상태 열은 이미 충분함(0002).
--    별도 스키마 변경 없음.
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- 5. exams — 중학교/고등학교 분류. folder_grade(학년, 1~3)만으로는 중/고 구분이 안 되므로
--    학교급 열을 새로 추가한다(기존 classes.level과 같은 값 집합: 초/중/고).
-- -------------------------------------------------------------------------
alter table public.exams add column school_level text check (school_level in ('초', '중', '고') or school_level is null);
comment on column public.exams.school_level is '이 시험이 속한 학교급(중/고 등). classes.level과 같은 값 집합.';
