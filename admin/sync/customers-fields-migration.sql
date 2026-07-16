alter table customers add column if not exists site_name text;
alter table customers add column if not exists region text;

-- 訂單目前只能新增/查詢，加上刪除權限（例如刪掉測試訂單）。
-- order_items 有 on delete cascade，刪 orders 時底下的明細會一併清掉。
create policy "Authenticated can delete orders" on orders for delete to authenticated using (true);

-- 訂單編號改成 PO-{民國年3碼}{MMDD}{當天流水號4碼}，例如 2026/7/16 第 4 張訂單是 PO-11507160004。
-- 流水號每天重置為 0001，用一張「每天一列」的計數表 + upsert 累加來保證同一天多人同時下單也不會撞號。
create table if not exists order_no_counters (
  day_key text primary key,
  seq integer not null default 0
);

alter table order_no_counters enable row level security;
create policy "Authenticated can use order_no_counters" on order_no_counters for all to authenticated using (true) with check (true);

create or replace function next_order_no() returns text
language plpgsql
as $$
declare
  key text;
  n integer;
begin
  key := (extract(year from now())::int - 1911)::text || to_char(now(), 'MMDD');

  insert into order_no_counters (day_key, seq) values (key, 1)
  on conflict (day_key) do update set seq = order_no_counters.seq + 1
  returning seq into n;

  return 'PO-' || key || lpad(n::text, 4, '0');
end;
$$;

alter table orders alter column order_no set default next_order_no();
