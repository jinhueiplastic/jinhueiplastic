-- 通用「修改紀錄」：訂單、客戶、商品每次被修改或刪除之前，資料庫層級的觸發器會自動
-- 把當時的完整內容存一份快照到這張表，不管是哪個頁面、哪個功能改的，甚至直接在
-- SQL Editor 手動改的，都不會漏記——之後才有得「找回前一版」。
-- record_id 統一存成文字（各表的 id 型別不完全一樣），用 table_name + record_id 查出
-- 某一筆資料的完整歷史。changed_by 是動手改的那個帳號的登入 email（用 auth.jwt() 從當下
-- 這次請求的登入資訊拿，不是另外要求前端多傳一個欄位，前端沒辦法假造）。

create table if not exists record_history (
    id bigint generated always as identity primary key,
    table_name text not null,
    record_id text not null,
    operation text not null, -- 'update' 或 'delete'
    snapshot jsonb not null,
    changed_by text, -- 動手改的那個帳號的 email（auth.jwt()，取不到的話是 SQL Editor 之類非登入操作）
    changed_at timestamptz not null default now()
);

create index if not exists record_history_lookup_idx on record_history (table_name, record_id, changed_at desc);

alter table record_history enable row level security;

drop policy if exists "Authenticated can read record_history" on record_history;
create policy "Authenticated can read record_history" on record_history for select to authenticated using (true);

drop policy if exists "Authenticated can insert record_history" on record_history;
create policy "Authenticated can insert record_history" on record_history for insert to authenticated with check (true);

-- orders：訂單本身要改之前，把「訂單欄位＋當時的 order_items」一起存成一份快照——
-- 這兩個是同一個編輯動作的兩半，要合在一起看才看得懂那一版訂單長怎樣。
-- 編輯訂單時 app 端一定會先 UPDATE orders 本身、才去刪除/重新插入 order_items
-- （見 pos.js 儲存訂單那段），所以這個 BEFORE UPDATE 觸發器抓到的 order_items 一定還是
-- 改之前的內容；刪除訂單也是同理（order_items 有 on delete cascade，會在這個 BEFORE
-- DELETE 觸發器之後才真的被砍掉）。
create or replace function record_orders_history() returns trigger as $$
declare
    items jsonb;
begin
    select coalesce(jsonb_agg(oi.* order by oi.created_at), '[]'::jsonb) into items
    from order_items oi where oi.order_id = OLD.id;

    insert into record_history (table_name, record_id, operation, snapshot, changed_by)
    values ('orders', OLD.id::text, lower(TG_OP), to_jsonb(OLD) || jsonb_build_object('__order_items', items), auth.jwt() ->> 'email');

    return OLD;
end;
$$ language plpgsql security definer;

drop trigger if exists orders_history_trigger on orders;
create trigger orders_history_trigger
    before update or delete on orders
    for each row execute function record_orders_history();

-- customers／pos_items：單純存一份改之前的欄位快照（不含子表資料）。
create or replace function record_simple_history() returns trigger as $$
begin
    insert into record_history (table_name, record_id, operation, snapshot, changed_by)
    values (TG_TABLE_NAME, OLD.id::text, lower(TG_OP), to_jsonb(OLD), auth.jwt() ->> 'email');
    return OLD;
end;
$$ language plpgsql security definer;

drop trigger if exists customers_history_trigger on customers;
create trigger customers_history_trigger
    before update or delete on customers
    for each row execute function record_simple_history();

drop trigger if exists pos_items_history_trigger on pos_items;
create trigger pos_items_history_trigger
    before update or delete on pos_items
    for each row execute function record_simple_history();
