-- 1. 檢查重複值。
--    注意：同一個 erp_code 出現在「不同分類」是正常的（同一項商品可以同時列在兩個分類下面
--    讓客戶從不同分類都找得到），所以不能對 erp_code 單獨加唯一限制。
--    真正不該重複的是「同一個 erp_code 在同一個分類底下出現兩次」，用下面這個查詢檢查：
select erp_code, category_name_zh, count(*) from products
where erp_code is not null and erp_code <> ''
group by erp_code, category_name_zh
having count(*) > 1;

select name_zh, count(*) from categories
group by name_zh
having count(*) > 1;

-- 2. 確認上面兩個查詢都沒有結果之後，再執行這兩行加上「不可重複」限制。
--    products 用「erp_code + 分類」的組合當唯一鍵，Google Sheet 的 upsert 同步就是靠這個
--    組合鍵知道要更新哪一筆、還是新增一筆（同一編號掛在不同分類會各自是一筆）。
alter table products add constraint products_erp_code_category_key unique (erp_code, category_name_zh);
alter table categories add constraint categories_name_zh_key unique (name_zh);

-- 3. 保險起見，讓新商品預設是上架狀態（避免 Sheet 新增的商品因為沒帶 is_active 而讀到 NULL 導致前台看不到）。
alter table products alter column is_active set default true;
update products set is_active = true where is_active is null;
