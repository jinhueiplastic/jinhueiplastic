-- 1. 檢查重複值：如果這兩個查詢有回傳任何一列，代表有重複資料，
--    要先手動清理（合併或改掉其中一筆），不然下面加限制條件會直接失敗。
select erp_code, count(*) from products
where erp_code is not null and erp_code <> ''
group by erp_code
having count(*) > 1;

select name_zh, count(*) from categories
group by name_zh
having count(*) > 1;

-- 2. 確認上面兩個查詢都沒有結果之後，再執行這兩行加上「不可重複」限制，
--    Google Sheet 的 upsert 同步靠這個限制才知道要更新哪一筆、而不是新增重複的一筆。
alter table products add constraint products_erp_code_key unique (erp_code);
alter table categories add constraint categories_name_zh_key unique (name_zh);

-- 3. 保險起見，讓新商品預設是上架狀態（避免 Sheet 新增的商品因為沒帶 is_active 而讀到 NULL 導致前台看不到）。
alter table products alter column is_active set default true;
update products set is_active = true where is_active is null;
