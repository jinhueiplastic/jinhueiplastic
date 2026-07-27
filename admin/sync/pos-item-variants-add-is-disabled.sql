-- 讓「完整組合」可以明確標記成「這個組合不能選」（例如型號=2 時顏色不會有紅），
-- 而不是用「有沒有建立組合」來判斷能不能選（那樣會誤傷本來就只是附加資訊、沒建滿的組合）。
alter table pos_item_variants add column if not exists is_disabled boolean not null default false;
