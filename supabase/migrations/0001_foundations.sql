-- Phase 0 foundations: pgvector, model-call ledger mirror, user profiles.
-- Every table has Row Level Security enabled.

create extension if not exists vector;

-- Mirror of the local JSONL cost ledger (packages/llm). Written only with the
-- service role key, which bypasses RLS; no policies are created, so anon and
-- authenticated callers cannot read or write this table.
create table public.llm_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  run_id text not null,
  task text not null,
  provider text not null default 'meta',
  model text not null,
  tokens_in integer not null default 0,
  tokens_cached integer not null default 0,
  tokens_out integer not null default 0,
  reasoning_tokens integer not null default 0,
  est_cost_usd numeric(12, 6) not null default 0,
  cached boolean not null default false,
  outcome text not null,
  error_kind text,
  latency_ms integer not null default 0
);

alter table public.llm_calls enable row level security;

-- One row per auth user. Users can read and write their own row only.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);
