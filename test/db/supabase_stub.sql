-- 로컬 PostgreSQL에 Supabase 비슷한 환경을 만든다(auth.uid()는 auth.cur 표, auth.role()은 request.jwt.claim.role 설정값).
-- Supabase처럼 공개 스키마의 표·함수는 anon·authenticated에 기본으로 전부 열려 있고, 막는 것은 RLS·함수 안 검사뿐이다.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', invited_at timestamptz);
create table auth.cur(uid uuid);
insert into auth.cur values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from auth.cur $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.cur to anon, authenticated, service_role;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create extension if not exists pgcrypto;
-- Supabase 기본 권한(공개 스키마의 새 표·함수·시퀀스는 anon·authenticated에 전부 허용)
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
