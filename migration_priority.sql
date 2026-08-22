-- ============================================================
-- 习惯打卡 v3 · 一次性迁移：习惯优先级（拖动排序）
-- 用法：Supabase -> SQL Editor -> 粘贴运行（非破坏性，可重复运行）。
-- ============================================================

-- 1) habits 增加排序字段
alter table public.habits add column if not exists sort_order integer not null default 0;

-- 2) 按现有创建顺序回填一次初值（仅当还没人排过序时执行，避免覆盖已有顺序）
update public.habits
set sort_order = t.rn
from (
  select id, row_number() over (order by created_at asc, id asc) - 1 as rn
  from public.habits
) t
where public.habits.id = t.id
  and public.habits.sort_order = 0
  and (select count(*) from public.habits h2 where h2.sort_order <> 0) = 0;
