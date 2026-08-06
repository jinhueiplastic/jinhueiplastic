-- 讓接線盒規格的軸選項／完整組合可以針對「第幾個接線盒」各自上傳不同的圖片
-- （例如接線盒 1 用已經畫在左邊位置的圖，接線盒 2 用已經畫在右邊位置的圖，疊起來就會是
-- 兩個分開的盒子，不用程式額外算位置）。key 是接線盒位置編號的字串（"2"、"3"…），
-- 沒有針對某個位置設定過的話，疊圖時會退回 image_url 這個預設圖。
alter table houjiao_box_variants add column if not exists image_urls_by_slot jsonb;

-- 如果之前跑過「架構可以拖拉設定接線盒位置」那個已經停用的功能的遷移，這裡順便清掉，
-- 沒跑過也沒關係（if exists 不會報錯）。
alter table houjiao_variants drop column if exists box_slots;
