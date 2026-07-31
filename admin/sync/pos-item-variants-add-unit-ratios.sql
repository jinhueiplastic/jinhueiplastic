-- 讓每個選項（軸的單一值，例如「尺寸：4"」）可以各自覆蓋單位比例，
-- 不用整個商品共用同一個「一箱幾個」。沒有覆蓋的選項，POS 下單會退回用
-- 商品層級（pos_item_units.ratio）的預設比例。
-- 格式跟 pos_item_units 的單位名稱對應，例如 {"箱": 24} 代表這個選項的「箱」是 24。
alter table pos_item_variants add column if not exists unit_ratios jsonb not null default '{}'::jsonb;
