-- 單位改成「每個商品各自記住自己常用的單位」，不再是全部商品共用同一份清單。
-- pos_units 保留下來，改當作「所有出現過的單位」的共用參考清單，方便在「修改 POS 商品」
-- 頁面快速把已經打過的單位加到某個商品身上，不用每次都重新打字。

create table if not exists pos_item_units (
    id bigint generated always as identity primary key,
    erp_code text not null,
    name text not null,
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    unique (erp_code, name)
);

alter table pos_item_units enable row level security;

create policy "Authenticated can read pos_item_units" on pos_item_units for select to authenticated using (true);
create policy "Authenticated can insert pos_item_units" on pos_item_units for insert to authenticated with check (true);
create policy "Authenticated can update pos_item_units" on pos_item_units for update to authenticated using (true) with check (true);
create policy "Authenticated can delete pos_item_units" on pos_item_units for delete to authenticated using (true);
