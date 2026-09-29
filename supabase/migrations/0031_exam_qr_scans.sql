-- 0031 — 원본 시험지 쪽 안에 인쇄된 QR 코드를 AI로 찾아, 학생·과외선생님용 PDF에서 흰 칸으로 가린다 (2026-09-29 원장님 요청)
--
-- 시험지 원본(학교·다른 학원·출처 사이트)에는 "QR 찍고 해설 보기" 같은 QR이 인쇄돼 있는 경우가 있다. 학원 이름으로
-- 나눠 주는 PDF에 남으면 곤란하므로, 시험마다 한 번 AI에게 "몇 쪽 어디에 QR이 있는지"를 물어 여기에 저장하고,
-- PDF를 만들 때(lib/ai/pdfStamp.ts) 그 자리를 흰 사각형으로 덮는다. 원본 파일 자체는 그대로 둔다.
--
-- 시험 하나당 한 줄: 진행 상태(submit → wait → done / error) + 찾은 QR 위치(boxes).
--   boxes: [{ "page": 원본 쪽 번호(1부터), "x0","y0","x1","y1": 그 쪽을 가로세로 1000칸으로 본 좌표(왼쪽 위 0,0) }]
--   pdf_key: 찾을 때의 원본 PDF 표시(저장 경로·올린 시각·디지털 적용 여부). PDF가 바뀌면 옛 위치는 쓰지 않고 다시 찾는다.
-- 진행은 크론(/api/ai/cron-tick)이 한다(lib/ai/qrMask.ts). 쓰기는 앱 서버(서비스롤)만.
-- 여러 번 실행해도 안전하다.

create table if not exists public.exam_qr_scans (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  stage text not null default 'submit' check (stage in ('submit', 'wait', 'done', 'error')),
  batch_id text,
  message text not null default '',
  attempts int not null default 0,
  boxes jsonb not null default '[]'::jsonb,
  pdf_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exam_qr_scans_stage_idx on public.exam_qr_scans (stage, updated_at);

alter table public.exam_qr_scans enable row level security;

-- 직원(편집자 이상이 PDF를 만든다)은 읽기 가능. 과외선생님 다운로드는 서버가 서비스롤로 읽는다.
drop policy if exists "exam_qr_scans_select_staff" on public.exam_qr_scans;
create policy "exam_qr_scans_select_staff"
  on public.exam_qr_scans for select to authenticated
  using (public.is_staff());

grant select on public.exam_qr_scans to authenticated;

-- 확인용:
--   select e.name, q.stage, jsonb_array_length(q.boxes) as qr_수, q.message
--   from public.exam_qr_scans q join public.exams e on e.id = q.exam_id order by q.updated_at desc;
