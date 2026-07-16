-- 客戶資料表
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  created_at timestamptz not null default now()
);

-- 訂單編號流水號（PO-000001, PO-000002, ...）
create sequence if not exists order_no_seq;

-- 訂單主檔
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('PO-' || lpad(nextval('order_no_seq')::text, 6, '0')),
  customer_id uuid references customers(id),
  created_at timestamptz not null default now()
);

-- 訂單明細：每一列是一個商品項，含挑選的規格/孔徑/顏色與數量。
-- 用 erp_code（已在先前的 migration.sql 加上唯一限制）對應商品，
-- 而不是 products.id，避免要另外確認 id 欄位型別；同時把商品名稱、圖片
-- 存成快照，即使之後商品資料異動，舊訂單顯示的還是下單當時的內容。
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_erp_code text references products(erp_code),
  product_name_zh text,
  product_image_url text,
  spec text,
  bore text,
  color text,
  quantity numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_erp_code_idx on order_items(product_erp_code);
create index if not exists orders_customer_id_idx on orders(customer_id);

alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "Authenticated can read customers" on customers for select to authenticated using (true);
create policy "Authenticated can insert customers" on customers for insert to authenticated with check (true);
create policy "Authenticated can update customers" on customers for update to authenticated using (true) with check (true);

create policy "Authenticated can read orders" on orders for select to authenticated using (true);
create policy "Authenticated can insert orders" on orders for insert to authenticated with check (true);

create policy "Authenticated can read order_items" on order_items for select to authenticated using (true);
create policy "Authenticated can insert order_items" on order_items for insert to authenticated with check (true);
create policy "Authenticated can delete order_items" on order_items for delete to authenticated using (true);
