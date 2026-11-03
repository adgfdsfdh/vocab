-- Словарь: таблицы, защита RLS и правило «побеждает последнее изменение».
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Скрипт можно запускать повторно — он ничего не сломает.

-- ───────────── Слова ─────────────
create table if not exists public.words (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id           uuid        not null,             -- вычисляется из слова, одинаковый на всех устройствах
  word         text        not null,
  translation  text        not null,
  alternatives jsonb       not null default '[]'::jsonb,
  note         text        not null default '',
  created_at   timestamptz not null,
  updated_at   timestamptz not null,             -- время изменения на устройстве
  deleted      boolean     not null default false,
  server_updated_at timestamptz not null default clock_timestamp(), -- для загрузки только новых изменений
  primary key (user_id, id)
);
create index if not exists words_user_server_updated on public.words (user_id, server_updated_at);

-- ───────────── Состояние повторений (FSRS, используется с F06) ─────────────
create table if not exists public.review_state (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  word_id    uuid        not null,
  card       jsonb       not null,               -- карточка ts-fsrs: due, stability, difficulty, reps, lapses, state…
  updated_at timestamptz not null,
  deleted    boolean     not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, word_id)
);
create index if not exists review_state_user_server_updated on public.review_state (user_id, server_updated_at);

-- ───────────── Побеждает последнее изменение ─────────────
-- Если устройство присылает запись старее той, что уже в базе, — запись не меняется.
create or replace function public.lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;                    -- владельца поменять нельзя
    if new.updated_at <= old.updated_at then
      return old;                                  -- старое или то же изменение — оставляем как есть
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists words_lww on public.words;
create trigger words_lww before insert or update on public.words
  for each row execute function public.lww_guard();

drop trigger if exists review_state_lww on public.review_state;
create trigger review_state_lww before insert or update on public.review_state
  for each row execute function public.lww_guard();

-- ───────────── RLS: каждый видит и меняет только свои строки ─────────────
alter table public.words enable row level security;
alter table public.review_state enable row level security;

drop policy if exists "words: own rows" on public.words;
create policy "words: own rows" on public.words
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "review_state: own rows" on public.review_state;
create policy "review_state: own rows" on public.review_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Анонимный (не вошедший) доступ к таблицам закрыт полностью.
revoke all on public.words, public.review_state from anon;
grant select, insert, update, delete on public.words, public.review_state to authenticated;
