-- 0059 (2026-11-07 사용자 "메딕차트 MCP 만들자" — 관리자·직원만, claude.ai 커스텀 커넥터, 모의고사·시험 올리기까지)
--   claude.ai(웹·앱·Cowork)가 메딕차트에 MCP로 연결할 때 쓰는 OAuth 2.1 표와 사용 기록.
--   - mcp_oauth_clients: 동적 클라이언트 등록(RFC 7591). claude.ai가 처음 연결할 때 스스로 등록한다.
--   - mcp_oauth_codes:   승인 화면(/oauth/authorize)에서 직원이 "허용"을 누르면 만드는 1회용 코드(PKCE S256, 10분).
--   - mcp_tokens:        access(1시간)·refresh(60일, 쓸 때마다 새로 바꿈) 토큰. 원문은 저장하지 않고 sha256만.
--   - mcp_audit:         MCP 도구 사용 기록(쓰기는 전부, 읽기도 남김). 관리자 화면 /admin/mcp 에서 본다.
--   네 표 모두 RLS를 켜고 정책을 두지 않는다 — 서버(서비스롤)만 읽고 쓴다(lib/mcp/*).
--   mcp_set_exam_status: 시험 열기/닫기는 트리거(enforce_exam_status_change_admin_only)가 "지금 로그인한 사람이 관리자"인지
--   보는데 서비스롤에는 로그인한 사람이 없다 → 이 함수가 요청한 직원(p_actor)으로 auth.uid()를 잠깐 바꿔 같은 검사를 그대로 받는다.
--   서비스롤만 부를 수 있다.
-- 여러 번 실행해도 안전하다. 0058 다음에 실행.

create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  client_name text not null default '' check (char_length(client_name) <= 200),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null default '',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  -- 같은 연결(승인 한 번)에서 나온 토큰 묶음 — 관리 화면에서 연결 단위로 끊는다
  grant_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists mcp_tokens_grant_idx on public.mcp_tokens (grant_id);
create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id, created_at desc);

create table if not exists public.mcp_audit (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  grant_id uuid,
  tool text not null,
  write boolean not null default false,
  args jsonb,
  ok boolean not null,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_audit_created_idx on public.mcp_audit (created_at desc);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.mcp_audit enable row level security;
revoke all on public.mcp_oauth_clients, public.mcp_oauth_codes, public.mcp_tokens, public.mcp_audit from anon, authenticated;

create or replace function public.mcp_set_exam_status(p_exam_id uuid, p_status text, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if p_status not in ('열림', '닫힘') then
    raise exception '상태는 열림 또는 닫힘만 됩니다.' using errcode = 'P0001';
  end if;
  select status into v_old from public.exams where id = p_exam_id;
  if v_old is null then
    raise exception '시험을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_old = '검수대기' then
    raise exception '검수 대기 시험은 검수 확정으로만 엽니다.' using errcode = 'P0001';
  end if;
  -- 이 트랜잭션 안에서만 auth.uid() = p_actor → 트리거의 is_admin() 검사를 요청한 직원 기준으로 받는다
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  update public.exams set status = p_status where id = p_exam_id;
  return v_old;
end;
$$;
revoke all on function public.mcp_set_exam_status(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mcp_set_exam_status(uuid, text, uuid) to service_role;

-- 확인
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'mcp\_%') as mcp_표,
       (select count(*) from pg_proc where proname = 'mcp_set_exam_status') as 열기_함수;
