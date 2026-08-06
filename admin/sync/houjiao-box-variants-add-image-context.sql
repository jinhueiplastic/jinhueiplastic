-- 讓接線盒規格的完整組合可以針對「這個架構 + 這個接線盒規格 + 第幾個位置」這個精確組合
-- 各自上傳專屬圖片（比 image_urls_by_slot 再多一層，連架構都要對得上才會用）。
-- key 是「架構完整組合的比對字串::位置編號」（例如 "形式長腳型接線盒數量2個長度6.5規格不附腳::2"）。
alter table houjiao_box_variants add column if not exists image_urls_by_context jsonb;
