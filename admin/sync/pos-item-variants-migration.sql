-- POS 規格/孔徑/顏色選項，每一列是「某商品的某一個可點選項目」，可以各自帶一張圖片。
create table if not exists pos_item_variants (
  id uuid primary key default gen_random_uuid(),
  erp_code text not null,
  variant_type text not null check (variant_type in ('spec', 'bore', 'color')),
  value text not null,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pos_item_variants_erp_code_idx on pos_item_variants(erp_code);

-- 同一個商品、同一種類型底下，選項名稱不該重複；Google Sheet 的 upsert 同步靠這個組合鍵比對。
alter table pos_item_variants add constraint pos_item_variants_key unique (erp_code, variant_type, value);

alter table pos_item_variants enable row level security;

-- 跟 pos_items 一樣，Sheet 同步指令碼用公開 anon key 呼叫，開放給所有角色讀寫。
create policy "Anyone can read pos_item_variants" on pos_item_variants for select using (true);
create policy "Anyone can insert pos_item_variants" on pos_item_variants for insert with check (true);
create policy "Anyone can update pos_item_variants" on pos_item_variants for update using (true) with check (true);
