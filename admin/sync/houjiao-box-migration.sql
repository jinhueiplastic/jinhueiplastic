-- 「接線盒規格」是「打腳通知」底下另外獨立的一組軸/選項/完整組合資料，跟「架構」
-- （houjiao_variants）完全分開管理：架構的「接線盒數量」選了幾個，畫面上就重複出現
-- 幾組「接線盒規格」選擇區，每組各自獨立選規格/內外耳/厚度/孔徑/顏色…（軸可以自己新增）。
-- 表格結構跟 houjiao_variants 一樣（一列一個軸的一個選項＝該選項的圖層小圖，
-- 一列兩個以上軸＝一筆完整組合，只用來標記「這個組合停用」，不需要組合自己的照片——
-- 顯示的圖是選好之後把每個軸選到的那個選項的小圖疊在一起合成出來的，不用每種組合都準備照片）。
create table if not exists houjiao_box_variants (
  id bigint generated always as identity primary key,
  axis_values jsonb not null,
  image_url text,
  sort_order int not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists houjiao_box_variants_key on houjiao_box_variants (axis_values);

alter table houjiao_box_variants enable row level security;

create policy "Authenticated can read houjiao_box_variants" on houjiao_box_variants for select to authenticated using (true);
create policy "Authenticated can insert houjiao_box_variants" on houjiao_box_variants for insert to authenticated with check (true);
create policy "Authenticated can update houjiao_box_variants" on houjiao_box_variants for update to authenticated using (true) with check (true);
create policy "Authenticated can delete houjiao_box_variants" on houjiao_box_variants for delete to authenticated using (true);

-- 每筆通知紀錄除了架構本身的 variant_values，另外多存一個陣列，記錄這筆通知裡
-- 每一個接線盒各自選了什麼（陣列長度＝架構「接線盒數量」選的數字）。
alter table houjiao_notifications add column if not exists box_values jsonb not null default '[]'::jsonb;
