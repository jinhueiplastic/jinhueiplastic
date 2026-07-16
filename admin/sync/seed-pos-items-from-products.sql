-- 一次性：把目前 products（完整商品目錄）複製一份到 pos_items，當作「修改 POS 商品」的起始資料。
-- 用 on conflict do nothing，所以已經存在於 pos_items 的 erp_code+分類 組合不會被覆蓋，
-- 之後在後台改過的 POS 商品資料不會被這個語句蓋掉，可以放心重複執行。
insert into pos_items (
  category_name_zh, erp_code, catalog_code, name_zh, name_en,
  on_alibaba, will_upload_alibaba, pcs_per_pack, unit, image_url,
  desc_zh, desc_en, dim_l, dim_w, dim_h, weight_kg, price_twd, price_usd,
  item_weight, height_cm, size, colour, depth, thickness, material,
  advantages, usage, notes, description, moq, shipments, remark,
  sample_website, keywords, store1_url, store2_url, store3_url, store4_url,
  is_active
)
select
  category_name_zh, erp_code, catalog_code, name_zh, name_en,
  on_alibaba, will_upload_alibaba, pcs_per_pack, unit, image_url,
  desc_zh, desc_en, dim_l, dim_w, dim_h, weight_kg, price_twd, price_usd,
  item_weight, height_cm, size, colour, depth, thickness, material,
  advantages, usage, notes, description, moq, shipments, remark,
  sample_website, keywords, store1_url, store2_url, store3_url, store4_url,
  is_active
from products
on conflict (erp_code, category_name_zh) do nothing;
