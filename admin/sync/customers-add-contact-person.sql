-- 客戶資訊新增「聯絡人」欄位（放在地址跟電話之間）。
alter table customers add column if not exists contact_person text;
