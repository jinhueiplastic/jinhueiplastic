-- 把 pos_item_variants 從「規格/孔徑/顏色」3 個固定欄位，改成彈性、可自訂數量與名稱的軸
-- （axis_values，一個 JSON，例如 {"型號":"A1","W":"10","H":"20"}）。
-- 既有資料會自動搬過去，還是用「規格」「孔徑」「顏色」這 3 個軸名稱，不需要重新設定。
-- 之後在「修改 POS 商品」頁面可以自由新增/命名任意軸（型號、W、H、L、A排水孔位、備註…不限數量），
-- 一列只填一個軸＝定義那個軸的一個可點選項目，一列填兩個以上的軸＝一筆「完整組合」（可以只是資訊、也可以帶照片）。

alter table pos_item_variants drop constraint if exists pos_item_variants_key;
alter table pos_item_variants add column if not exists axis_values jsonb not null default '{}'::jsonb;

update pos_item_variants set axis_values =
    (case when coalesce(spec, '') <> '' then jsonb_build_object('規格', spec) else '{}'::jsonb end) ||
    (case when coalesce(bore, '') <> '' then jsonb_build_object('孔徑', bore) else '{}'::jsonb end) ||
    (case when coalesce(color, '') <> '' then jsonb_build_object('顏色', color) else '{}'::jsonb end)
where axis_values = '{}'::jsonb
  and (coalesce(spec, '') <> '' or coalesce(bore, '') <> '' or coalesce(color, '') <> '');

alter table pos_item_variants drop column if exists spec;
alter table pos_item_variants drop column if exists bore;
alter table pos_item_variants drop column if exists color;
alter table pos_item_variants drop column if exists variant_type;
alter table pos_item_variants drop column if exists value;

create unique index if not exists pos_item_variants_key on pos_item_variants (erp_code, axis_values);
