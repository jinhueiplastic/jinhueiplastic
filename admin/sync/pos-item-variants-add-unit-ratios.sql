-- 讓每一筆完整組合（同一列填兩個以上軸的值，例如「型號：PF-16／規格：½"／長度：50米/丸」）
-- 可以各自覆蓋單位比例，不用整個商品共用同一個「一箱幾個」。沒有覆蓋的組合，POS 下單會
-- 退回用商品層級（pos_item_units.ratio）的預設比例。
-- 格式跟 pos_item_units 的單位名稱對應，例如 {"箱": 24} 代表這筆組合的「箱」是 24。
alter table pos_item_variants add column if not exists unit_ratios jsonb not null default '{}'::jsonb;
