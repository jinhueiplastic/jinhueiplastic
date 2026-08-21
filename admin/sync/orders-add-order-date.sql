-- 把「訂單日期」（POS 下單挑選的日期，可以補登/預先建立，使用者能改）跟「建立日期」
-- （這筆訂單真正存進資料庫的時間，不該因為之後編輯訂單而改變）分開存。
-- 本來 created_at 是「使用者選的日期＋存檔當下的時間」混在一起，編輯訂單改日期時
-- 連同存檔時間一起被覆蓋掉，原本真正的建立時間就不見了。
-- order_date 只存日期（不含時分秒）；用現有 created_at 的日期部分回填舊訂單，
-- 這樣舊訂單也能立刻正常顯示、搜尋。
alter table orders add column if not exists order_date date;
update orders set order_date = created_at::date where order_date is null;
alter table orders alter column order_date set default current_date;
alter table orders alter column order_date set not null;
