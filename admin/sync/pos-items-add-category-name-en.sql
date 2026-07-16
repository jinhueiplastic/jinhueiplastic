-- admin.js 的商品編輯表單有「分類（英文）」欄位，但 pos_items 建表時漏掉了這一欄，
-- 導致儲存商品時 PostgREST 找不到這個欄位而整筆失敗。
alter table pos_items add column if not exists category_name_en text;
