-- 每個軸（例如「簡稱」「型號」）可以設定「要不要顯示在下單名稱」，開啟的話 POS 下單購物車
-- 那格粗體標題會變成「{選到的值} {商品名稱}」（例如「4分 CD盒接」），不開的話維持只顯示商品名稱。
-- 這個設定是存在「軸選項」那幾列（axis_values 只有 1 個 key 的列）上，同一個軸底下的所有選項
-- 要一起開/關（在「修改 POS 商品」畫面是整個軸一起切換）。
alter table pos_item_variants add column if not exists show_in_name boolean not null default false;
