-- 訂單明細的規格/孔徑/顏色改成彈性軸之後，訂單存檔時要能記錄任意數量、任意名稱的軸快照
-- （例如 {"型號":"A1","W":"10","H":"20","L":"30","A排水孔位":"top","備註":"-"}）。
-- 舊訂單的 spec/bore/color 保留不動，畫面顯示時新舊資料都看得到（新資料優先）。
alter table order_items add column if not exists variant_values jsonb not null default '{}'::jsonb;
