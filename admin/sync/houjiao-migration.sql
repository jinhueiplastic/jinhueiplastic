-- 「打腳通知」是後台一個獨立、只有一份規格的虛擬商品（不像 POS 有一堆各自商品各自的規格），
-- 概念跟 pos_item_variants 一樣（軸名稱、選項數量都不限，一列只填一個軸＝定義那個軸的
-- 一個可點選項目，一列填兩個以上的軸＝一筆「完整組合」，可以只是資訊、也可以帶照片、
-- 也可以標記停用），只是不需要 erp_code 去區分「哪個商品」。
create table if not exists houjiao_variants (
  id bigint generated always as identity primary key,
  axis_values jsonb not null,
  image_url text,
  sort_order int not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists houjiao_variants_key on houjiao_variants (axis_values);

alter table houjiao_variants enable row level security;

create policy "Authenticated can read houjiao_variants" on houjiao_variants for select to authenticated using (true);
create policy "Authenticated can insert houjiao_variants" on houjiao_variants for insert to authenticated with check (true);
create policy "Authenticated can update houjiao_variants" on houjiao_variants for update to authenticated using (true) with check (true);
create policy "Authenticated can delete houjiao_variants" on houjiao_variants for delete to authenticated using (true);

-- 「打腳通知」頁面選完規格數量、送出之後存的每一筆通知紀錄。
create table if not exists houjiao_notifications (
  id bigint generated always as identity primary key,
  variant_values jsonb not null default '{}'::jsonb,
  qty numeric not null default 1,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table houjiao_notifications enable row level security;

create policy "Authenticated can read houjiao_notifications" on houjiao_notifications for select to authenticated using (true);
create policy "Authenticated can insert houjiao_notifications" on houjiao_notifications for insert to authenticated with check (true);
