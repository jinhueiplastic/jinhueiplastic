-- 把 pos_item_variants 從「一列一個軸選項（type + value 兩欄）」
-- 改成「規格/孔徑/顏色各自一欄」，同一張表就能同時表示：
--   只填一欄 → 定義一個可點選項目（按鈕）
--   填多欄   → 那個確切組合的實際商品照片
-- POS combo images 那張表因此不再需要，一起併掉。

alter table pos_item_variants drop constraint if exists pos_item_variants_key;

alter table pos_item_variants add column if not exists spec text not null default '';
alter table pos_item_variants add column if not exists bore text not null default '';
alter table pos_item_variants add column if not exists color text not null default '';

-- 把舊資料（如果已經有填過的話）搬到新欄位，目前應該是空的，這幾行跑了也不會出錯。
update pos_item_variants set spec = value where variant_type = 'spec';
update pos_item_variants set bore = value where variant_type = 'bore';
update pos_item_variants set color = value where variant_type = 'color';

alter table pos_item_variants drop column if exists variant_type;
alter table pos_item_variants drop column if exists value;

alter table pos_item_variants add constraint pos_item_variants_key unique (erp_code, spec, bore, color);

drop table if exists pos_item_combo_images;
