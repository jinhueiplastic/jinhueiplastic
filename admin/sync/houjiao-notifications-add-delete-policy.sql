-- houjiao_notifications 當初只設了 select/insert 權限，沒有 delete，導致「通知紀錄」
-- 要能刪除每一筆時，實際上什麼都刪不到（RLS 沒權限的刪除會安靜地刪 0 筆，不會報錯）——
-- 跟先前 pos_items／pos_item_variants 漏掉 delete policy 是同一種問題。
create policy "Authenticated can delete houjiao_notifications" on houjiao_notifications for delete to authenticated using (true);
