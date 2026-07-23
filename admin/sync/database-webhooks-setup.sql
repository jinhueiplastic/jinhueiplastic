-- 幫 products / pos_items / pos_item_variants 這 3 張表各建立一個 Database Webhook，
-- 資料一有異動（新增/修改/刪除）就自動 POST 到 Apps Script 網頁應用程式網址，觸發自動拉回 Google Sheet。
-- 這其實就是 Supabase 後台「Database → Webhooks → Create a new hook」按鈕做的事，
-- 用 SQL 直接建立效果完全一樣（如果後台找不到那個按鈕，直接跑這份就好）。

create extension if not exists pg_net;

drop trigger if exists sync_products_webhook on public.products;
create trigger sync_products_webhook
  after insert or update or delete on public.products
  for each row execute function supabase_functions.http_request(
    'https://script.google.com/macros/s/AKfycbzJbYxQ_FkitIRORAdomNnIC7qLA2ElWaKPBgEbyD9UPYCzUa3T4ncTMuBV1cvqgDUFeA/exec?secret=giohoioghidfogjhisaqzz',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );

drop trigger if exists sync_pos_items_webhook on public.pos_items;
create trigger sync_pos_items_webhook
  after insert or update or delete on public.pos_items
  for each row execute function supabase_functions.http_request(
    'https://script.google.com/macros/s/AKfycbzJbYxQ_FkitIRORAdomNnIC7qLA2ElWaKPBgEbyD9UPYCzUa3T4ncTMuBV1cvqgDUFeA/exec?secret=giohoioghidfogjhisaqzz',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );

drop trigger if exists sync_pos_item_variants_webhook on public.pos_item_variants;
create trigger sync_pos_item_variants_webhook
  after insert or update or delete on public.pos_item_variants
  for each row execute function supabase_functions.http_request(
    'https://script.google.com/macros/s/AKfycbzJbYxQ_FkitIRORAdomNnIC7qLA2ElWaKPBgEbyD9UPYCzUa3T4ncTMuBV1cvqgDUFeA/exec?secret=giohoioghidfogjhisaqzz',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );
