-- POS 下單「選購商品」跟「取貨標籤」之間新增的「備註」輸入框：純自由文字，跟取貨標籤不一樣，
-- 不會被學起來變成下次可以點選的清單，單純記在這張訂單上。
alter table orders add column if not exists note text;
