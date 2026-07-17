-- pos_item_variants 當初只設了 select/insert/update 權限，漏了 delete，
-- 導致刪除規格選項或組合照片時，實際上什麼都沒刪到（RLS 沒權限的刪除會安靜地刪 0 筆，不會報錯）。
create policy "Anyone can delete pos_item_variants" on pos_item_variants for delete using (true);
