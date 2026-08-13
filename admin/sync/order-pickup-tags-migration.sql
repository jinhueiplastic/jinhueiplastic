-- POS 下單時可以順便標記這張訂單的取貨方式（自取、放車自取、明早自取…），跟訂單單位
-- （pos_units）是同一套「固定清單＋可以打字新增」的邏輯，打過的新標籤會存起來，下次就有
-- 按鈕可以直接點。
create table if not exists order_pickup_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table order_pickup_tags enable row level security;

create policy "Authenticated can read order_pickup_tags" on order_pickup_tags for select to authenticated using (true);
create policy "Authenticated can insert order_pickup_tags" on order_pickup_tags for insert to authenticated with check (true);

insert into order_pickup_tags (name, sort_order) values
  ('自取', 1),
  ('放車自取', 2),
  ('明早自取', 3)
on conflict (name) do nothing;

-- 訂單本身記錄選了哪個標籤（沒選就是 null）。
alter table orders add column if not exists pickup_tag text;
