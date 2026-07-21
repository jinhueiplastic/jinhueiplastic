-- POS 下單「數量」旁邊的單位選項（個/支/包/箱…等），可以在 POS 下單頁按鈕選、
-- 也可以直接打字新增（打過的新單位存訂單後會自動變成永久選項，下次就有按鈕可以點）。
-- 是全店共用的單一份清單，不像規格/孔徑/顏色是綁在個別商品上。

create table if not exists pos_units (
    id bigint generated always as identity primary key,
    name text not null unique,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
);

alter table pos_units enable row level security;

create policy "Authenticated can read pos_units" on pos_units for select to authenticated using (true);
create policy "Authenticated can insert pos_units" on pos_units for insert to authenticated with check (true);
create policy "Authenticated can update pos_units" on pos_units for update to authenticated using (true) with check (true);
create policy "Authenticated can delete pos_units" on pos_units for delete to authenticated using (true);

-- 訂單明細也要能記錄選的是哪個單位。
alter table order_items add column if not exists unit text;
