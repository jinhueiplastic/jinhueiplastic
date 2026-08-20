-- POS 下單選購商品時，每個購物車項目（每個商品）可以自己填一個備註，
-- 跟整張訂單共用的 orders.note 不一樣：這個是每個商品各自不同、選填的備註。
alter table order_items add column if not exists note text;
