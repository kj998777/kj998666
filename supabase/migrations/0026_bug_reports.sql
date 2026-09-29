-- 2026-09-29 원장님 요청: 과외선생님 화면에서 따로 버그를 신고할 수 있는 창.
--
-- bug_reports: 과외선생님이 보낸 신고(종류·제목·내용·문제가 생긴 화면·스크린샷)와 관리자의 처리 상태·답변.
--   RLS는 켜되 정책을 하나도 두지 않는다 → 브라우저(anon/authenticated)에서는 읽기·쓰기 모두 불가.
--   과외 화면(/tutor/bugs)과 관리자 화면(/admin/bug-reports)의 서버 코드가 로그인·권한을 확인한 뒤
--   서비스롤로만 읽고 쓴다(본인 신고만 보이게 하는 것도 서버 코드가 reporter_id로 거른다).
-- 스크린샷은 기존 비공개 버킷 tutor-review-photos의 bugs/<신고 id>/ 아래에 저장한다(새 버킷 없음).
--
-- 0025 다음에 실행.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default '기타'
    check (category in ('화면·기능 오류', '문제·해설 오류', '포인트·구매', '기타')),
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 4000),
  page_hint text check (page_hint is null or char_length(page_hint) <= 300),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  status text not null default '접수' check (status in ('접수', '확인 중', '해결', '보류')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bug_reports_reporter_idx on public.bug_reports (reporter_id, created_at desc);
create index if not exists bug_reports_status_idx on public.bug_reports (status, created_at desc);

alter table public.bug_reports enable row level security;
-- (정책 없음: 서비스롤 전용)
