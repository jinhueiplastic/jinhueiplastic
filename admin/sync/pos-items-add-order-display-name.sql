-- 每個品項可以另外設定「下單名稱」，沒填的話 POS 下單／查詢訂單／區域表單就顯示原本的中文品名。
alter table pos_items add column if not exists order_display_name text;
