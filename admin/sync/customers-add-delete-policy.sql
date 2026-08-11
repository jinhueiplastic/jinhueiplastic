-- customers 當初只設了 select/insert/update 權限，沒有 delete，導致「客戶資訊」頁面
-- 要能刪除客戶時，實際上什麼都刪不到（RLS 沒權限的刪除會安靜地刪 0 筆，不會報錯）——
-- 跟先前 houjiao_notifications／pos_items 漏掉 delete policy 是同一種問題。
create policy "Authenticated can delete customers" on customers for delete to authenticated using (true);
