-- ============================================================
-- 习惯打卡 v2 · Supabase 建表脚本（含登录，按账号隔离）
-- 用法：Supabase 控制台 -> SQL Editor -> 粘贴运行。
-- 本脚本可安全重复运行（幂等），【不含删除数据的语句】。
-- 老用户升级：请先运行 migration_login.sql（会清空旧数据）。
-- ============================================================

-- 习惯表（含账号归属）
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  emoji text not null default '📌',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 打卡记录表（每个习惯每天一条）
create table if not exists public.checkins (
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, date)
);

-- 开启行级安全
alter table public.habits enable row level security;
alter table public.checkins enable row level security;

-- 按账号隔离的策略
drop policy if exists "habits select" on public.habits;
create policy "habits select" on public.habits for select using (user_id = auth.uid());
drop policy if exists "habits insert" on public.habits;
create policy "habits insert" on public.habits for insert with check (auth.uid() = user_id);
drop policy if exists "habits update" on public.habits;
create policy "habits update" on public.habits for update using (user_id = auth.uid()) with check (auth.uid() = user_id);
drop policy if exists "habits delete" on public.habits;
create policy "habits delete" on public.habits for delete using (user_id = auth.uid());

drop policy if exists "checkins select" on public.checkins;
create policy "checkins select" on public.checkins for select using (
  exists (select 1 from public.habits where habits.id = checkins.habit_id and habits.user_id = auth.uid())
);
drop policy if exists "checkins insert" on public.checkins;
create policy "checkins insert" on public.checkins for insert with check (
  exists (select 1 from public.habits where habits.id = checkins.habit_id and habits.user_id = auth.uid())
);
drop policy if exists "checkins delete" on public.checkins;
create policy "checkins delete" on public.checkins for delete using (
  exists (select 1 from public.habits where habits.id = checkins.habit_id and habits.user_id = auth.uid())
);

-- 实时同步（可重复运行，不会报错）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'habits'
  ) then
    execute 'alter publication supabase_realtime add table public.habits';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'checkins'
  ) then
    execute 'alter publication supabase_realtime add table public.checkins';
  end if;
end $$;


