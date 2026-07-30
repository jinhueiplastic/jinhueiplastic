-- 讓 POS 下單頁面同分類底下的商品，可以照 Google Sheet「POS items」分頁裡由上到下
-- 的順序排列，不用再依賴貨號或資料庫本身不保證的預設順序。
-- 這個欄位是 Google Sheet 同步指令碼（products-sync.gs）寫入的，「修改 POS 商品」
-- 頁面手動新增的商品沒有跑過同步，會維持 0，排在同分類最前面。
alter table pos_items add column if not exists row_index integer not null default 0;
