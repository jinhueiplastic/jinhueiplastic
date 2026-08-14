-- 「顯示在下單名稱」原本預設關閉，需要使用者一個一個軸手動打開。改成預設開啟：
-- 1. 既有資料全部先打開（使用者自己再把不需要的軸關掉，比一個個手動打開快）。
-- 2. 這欄位以後預設也是開的，之後新增的軸（不管是「修改 POS 商品」或 POS 下單「+新增規格軸」）
--    一開始也會是顯示的狀態。
-- 「完整組合」列（axis_values 有兩個以上 key）也會一起被設成 true，但這個欄位本來就只有
-- 「軸選項」列（只有一個 key）在用，完整組合上的值不會被讀到，設了也不影響任何功能。
alter table pos_item_variants alter column show_in_name set default true;
update pos_item_variants set show_in_name = true where show_in_name = false;
