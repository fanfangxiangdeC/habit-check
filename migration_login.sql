-- ============================================================
-- 习惯打卡 v2 · 一次性迁移脚本（加入邮箱登录）
-- 用法：Supabase 控制台 -> SQL Editor -> 粘贴运行【一次】即可。
-- ⚠️ 注意：本脚本会【清空所有现有习惯和打卡记录】（从零开始）。
-- ============================================================

-- 1) 清空旧数据（v1 无账号归属，全部删除）
delete from public.checkins;
delete from public.habits;

-- 2) habits 增加账号归属字段（默认填当前登录用户）
alter table public.habits add column if not exists user_id uuid not null default auth.uid();

-- 3) 开启行级安全
alter table public.habits enable row level security;
alter table public.checkins enable row level security;

-- 4) 替换为“按账号隔离”的策略
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

-- 5) 实时同步（可重复运行，不会报错）
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
