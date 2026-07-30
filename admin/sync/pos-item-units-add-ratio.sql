-- 讓每個商品的單位可以設定「比例」，例如 個=1、箱=12，這樣有 2 個以上單位時
-- 才知道「一箱是幾個」。沒特別設定的話一律當作 1（沒有換算關係）。
alter table pos_item_units add column if not exists ratio numeric not null default 1;
alter table pos_item_units add constraint pos_item_units_ratio_positive check (ratio > 0);
