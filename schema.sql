-- ============================================================
-- 习惯打卡 · Supabase 建表脚本
-- 用法：在 Supabase 控制台 -> SQL Editor 中新建查询，粘贴本文件全部内容后运行。
-- 本脚本可以安全地重复运行（幂等），重复运行不会报错。
-- ============================================================

-- 习惯表
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '📌',
  created_at timestamptz not null default now()
);

-- 打卡记录表（每个习惯每天一条）
create table if not exists public.checkins (
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, date)
);

-- 开启行级安全（个人自用：允许匿名读写，单份共享数据）
alter table public.habits enable row level security;
alter table public.checkins enable row level security;

drop policy if exists "habits select" on public.habits;
create policy "habits select" on public.habits for select using (true);
drop policy if exists "habits insert" on public.habits;
create policy "habits insert" on public.habits for insert with check (true);
drop policy if exists "habits update" on public.habits;
create policy "habits update" on public.habits for update using (true) with check (true);
drop policy if exists "habits delete" on public.habits;
create policy "habits delete" on public.habits for delete using (true);

drop policy if exists "checkins select" on public.checkins;
create policy "checkins select" on public.checkins for select using (true);
drop policy if exists "checkins insert" on public.checkins;
create policy "checkins insert" on public.checkins for insert with check (true);
drop policy if exists "checkins delete" on public.checkins;
create policy "checkins delete" on public.checkins for delete using (true);

-- 开启实时同步（多设备自动刷新用；已加入过的表会跳过，不会报错）
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
