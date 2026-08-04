-- pos_items 當初只設了 select/insert/update 權限，漏了 delete，導致「推送 POS items
-- 到 Supabase」偵測到下架+已從 Sheet 移除的商品、想刪掉時，實際上什麼都沒刪到
-- （RLS 沒權限的刪除會安靜地刪 0 筆，不會報錯，看起來就像沒反應）。
create policy "Anyone can delete pos_items" on pos_items for delete using (true);
