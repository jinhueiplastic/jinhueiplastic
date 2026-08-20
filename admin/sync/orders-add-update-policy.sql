-- 找到問題了：orders 資料表有 RLS，但從來沒有加過「update」的權限（只有
-- select／insert／delete），POS 下單「編輯」既有訂單時改客戶/取貨標籤/備註/日期，
-- 資料庫會直接擋掉這個更新——不會噴錯誤訊息，畫面上看起來存檔成功、正常跳轉，
-- 但那幾個欄位其實完全沒有真的被改到。商品明細（order_items）本來就有 delete／
-- insert 權限，所以改購買的商品/數量不受影響，只有訂單本身的欄位（客戶等）会被擋下來。
create policy "Authenticated can update orders" on orders for update to authenticated using (true) with check (true);
