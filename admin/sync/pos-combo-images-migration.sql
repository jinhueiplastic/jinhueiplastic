-- 每一列是「某商品的某一個確切規格+孔徑+顏色組合」實際商品照片。
-- 沒選到的軸（例如商品沒有孔徑這個屬性）就留空字串，不是 null，
-- 這樣同一組合的比對鍵才會穩定（null 在唯一限制條件裡每次都算不同值，空字串才會真的擋重複）。
create table if not exists pos_item_combo_images (
  id uuid primary key default gen_random_uuid(),
  erp_code text not null,
  spec text not null default '',
  bore text not null default '',
  color text not null default '',
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists pos_item_combo_images_erp_code_idx on pos_item_combo_images(erp_code);
alter table pos_item_combo_images add constraint pos_item_combo_images_key unique (erp_code, spec, bore, color);

alter table pos_item_combo_images enable row level security;

-- 跟 pos_items／pos_item_variants 一樣，Sheet 同步指令碼用公開 anon key 呼叫。
create policy "Anyone can read pos_item_combo_images" on pos_item_combo_images for select using (true);
create policy "Anyone can insert pos_item_combo_images" on pos_item_combo_images for insert with check (true);
create policy "Anyone can update pos_item_combo_images" on pos_item_combo_images for update using (true) with check (true);
