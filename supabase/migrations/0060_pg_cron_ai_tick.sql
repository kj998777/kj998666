-- 0060 (2026-11-26) AI 처리 크론을 Supabase pg_cron으로 — 외부 크론 서비스가 11월 중순부터 멈춰
--   AI 자동 처리·디지털화·영역 찾기·QR 찾기·주간 백업이 진행되지 않았다(시험 화면을 열어 둔 동안만 진행).
--   pg_cron + pg_net이 1분마다 https://medicchart.vercel.app/api/ai/cron-tick 를 부른다.
--   인증: Vercel의 AI_CRON_SECRET을 DB로 옮기지 않고, DB 전용 토큰을 따로 만든다.
--     - 원문: private.cron_token (PostgREST에 노출되지 않는 스키마, anon·authenticated 권한 없음)
--     - 해시: public.ops_cron_token.token_hash (RLS 켜고 정책 없음 → 서비스롤만) — 라우트가 이것과 대조
--   토큰을 바꾸려면 아래 "토큰 만들기" 부분만 다시 실행하면 된다(라우트는 5분 안에 새 해시를 읽음).
-- 여러 번 실행해도 안전하다.

create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.cron_token (
  id int primary key default 1 check (id = 1),
  token text not null,
  created_at timestamptz not null default now()
);
revoke all on private.cron_token from public, anon, authenticated;

create table if not exists public.ops_cron_token (
  id int primary key default 1 check (id = 1),
  token_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.ops_cron_token enable row level security;
revoke all on public.ops_cron_token from anon, authenticated;

-- 토큰 만들기(없을 때만)
do $$
declare t text;
begin
  if not exists (select 1 from private.cron_token where id = 1) then
    t := encode(gen_random_bytes(32), 'hex');
    insert into private.cron_token (id, token) values (1, t);
    insert into public.ops_cron_token (id, token_hash) values (1, encode(digest(t, 'sha256'), 'hex'))
      on conflict (id) do update set token_hash = excluded.token_hash, created_at = now();
  end if;
end $$;

-- 1분마다 부르기(이미 있으면 바꿈). pg_net은 응답을 기다리지 않는다.
select cron.schedule(
  'medicchart-ai-tick',
  '* * * * *',
  $cmd$select net.http_post(
    url := 'https://medicchart.vercel.app/api/ai/cron-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-db-token', (select token from private.cron_token where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )$cmd$
);
