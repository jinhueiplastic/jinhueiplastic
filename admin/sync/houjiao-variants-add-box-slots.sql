-- 讓「架構」的完整組合可以各自記錄每個接線盒要疊在畫布上的哪個位置/多大
-- （百分比 0~1，例如 [{"x":0.1,"y":0.4,"w":0.2,"h":0.2}, ...]），沒設定過的話是 null，
-- 疊圖時會退回原本的「整張蓋滿」畫法。
alter table houjiao_variants add column if not exists box_slots jsonb;
