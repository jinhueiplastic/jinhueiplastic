-- 每個系列（分類）自己的封面圖網址，給 POS 下單「目錄」畫面的分類卡片用。
-- 跟 Google Sheet「網站內容」那邊的分類卡片（site_content, page = 'Product Catalog'）完全分開：
-- 那邊是靠 link 欄位比對 category_name_zh，改分類名稱時不會一起改，導致封面圖抓不到、
-- 退而用商品自己的照片頂著。這張表由「修改 POS 商品」直接管理，重新命名系列時會一起改
-- 這裡的 category_name_zh，封面圖不會再因為改名就跑掉。

create table if not exists pos_categories (
    category_name_zh text primary key,
    image_url text,
    updated_at timestamptz not null default now()
);

alter table pos_categories enable row level security;

create policy "Authenticated can read pos_categories" on pos_categories for select to authenticated using (true);
create policy "Authenticated can insert pos_categories" on pos_categories for insert to authenticated with check (true);
create policy "Authenticated can update pos_categories" on pos_categories for update to authenticated using (true) with check (true);
create policy "Authenticated can delete pos_categories" on pos_categories for delete to authenticated using (true);
