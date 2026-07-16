-- POS 下單頁面專用的商品子集合，跟 products 完全分開的一張表。
-- 官網、後台「修改商品資料」頁都不會動到這張表，只有 /admin/pos.html 會讀。
-- 欄位跟 products／Google Sheet「POS items」分頁一致。
create table if not exists pos_items (
  id uuid primary key default gen_random_uuid(),
  category_name_zh text,
  erp_code text,
  catalog_code text,
  name_zh text,
  name_en text,
  on_alibaba boolean,
  will_upload_alibaba boolean,
  pcs_per_pack text,
  unit text,
  image_url text,
  desc_zh text,
  desc_en text,
  dim_l numeric,
  dim_w numeric,
  dim_h numeric,
  weight_kg numeric,
  price_twd numeric,
  price_usd numeric,
  item_weight text,
  height_cm text,
  size text,
  colour text,
  depth text,
  thickness text,
  material text,
  advantages text,
  usage text,
  notes text,
  description text,
  moq text,
  shipments text,
  remark text,
  sample_website text,
  keywords text,
  store1_url text,
  store2_url text,
  store3_url text,
  store4_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 跟 products 一樣，同一個 erp_code 可能同時掛在不同分類底下，
-- 所以唯一鍵是「erp_code + 分類」的組合，讓 Google Sheet 的 upsert 同步知道要更新哪一筆。
alter table pos_items add constraint pos_items_erp_code_category_key unique (erp_code, category_name_zh);

alter table pos_items enable row level security;

-- Google Sheet 那邊的同步指令碼是用公開的 anon key 呼叫（跟 products/categories 的既有同步方式一樣），
-- 不是走後台登入的 session，所以這裡開放給所有角色讀寫，而不是只給 authenticated。
create policy "Anyone can read pos_items" on pos_items for select using (true);
create policy "Anyone can insert pos_items" on pos_items for insert with check (true);
create policy "Anyone can update pos_items" on pos_items for update using (true) with check (true);
