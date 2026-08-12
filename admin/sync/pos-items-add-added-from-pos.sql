-- 讓「POS 下單」選購商品時新增的商品（目錄裡完全沒出現過、當場手動輸入名稱新增的），
-- 在「修改 POS 商品」頁面可以被標記出來，方便之後找到、把資料（正式 ERP 編號、圖片、
-- 價格…）補齊。補齊後在「修改 POS 商品」按儲存，這個旗標會自動清掉，代表已經是正式商品了。
alter table pos_items add column if not exists added_from_pos boolean not null default false;
