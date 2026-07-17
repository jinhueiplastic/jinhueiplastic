-- 一次性：把「修改 POS 商品」編輯頁裡「從商品說明表格匯入選項」按鈕做的事情，
-- 對所有 pos_items 商品一次跑完，把中文說明（desc_zh）裡的規格表格解析出來，
-- 匯入成 pos_item_variants 的規格/孔徑/顏色選項。
-- 邏輯完全比照 admin/admin.js 的 parseAllVariantTables + classifyOptionsFromDesc + splitBulkValues：
--   表頭含「孔」或「徑」→ 孔徑；含「色」→ 顏色；其他 → 規格
--   每個表格資料列的第一欄當作候選值，用 / 、 , ， 分隔成多個值，去掉頭尾括號
--   已經存在的選項（erp_code+spec+bore+color 完全相同）不會重複新增，也不會覆蓋掉既有的圖片。
--
-- 這個 SQL 只新增資料，不會刪除或覆蓋任何既有的 pos_item_variants 資料，執行完可以直接在
-- 「修改 POS 商品」頁面檢查結果。可以重複執行，不會造成重複資料。

do $$
declare
    prod record;
    lines text[];
    n int;
    i int;
    j int;
    trimmed text;
    block_start int;
    block_end int;
    header_cells text[];
    header_text text;
    axis_type text;
    data_line text;
    cells text[];
    first_cell text;
    parts text[];
    part text;
begin
    for prod in select erp_code, desc_zh from pos_items where coalesce(erp_code, '') <> '' and coalesce(desc_zh, '') <> ''
    loop
        lines := regexp_split_to_array(prod.desc_zh, E'\n');
        n := coalesce(array_length(lines, 1), 0);
        i := 1;
        while i <= n loop
            trimmed := trim(lines[i]);
            if left(trimmed, 1) = '|' and position('|' in trimmed) > 0 then
                block_start := i;
                block_end := i;
                while block_end + 1 <= n and left(trim(lines[block_end + 1]), 1) = '|' loop
                    block_end := block_end + 1;
                end loop;

                select array_agg(trim(c))
                into header_cells
                from unnest(string_to_array(trim(both '|' from trim(lines[block_start])), '|')) as c;
                header_text := array_to_string(header_cells, '');

                if header_text ~ '孔|徑' then
                    axis_type := 'bore';
                elsif header_text ~ '色' then
                    axis_type := 'color';
                else
                    axis_type := 'spec';
                end if;

                for j in (block_start + 1)..block_end loop
                    data_line := lines[j];
                    if trim(data_line) ~ '^[|:\s-]+$' then
                        continue;
                    end if;

                    select array_agg(trim(c))
                    into cells
                    from unnest(string_to_array(trim(both '|' from trim(data_line)), '|')) as c;

                    if cells is null or array_length(cells, 1) < 1 then
                        continue;
                    end if;

                    first_cell := cells[1];
                    if first_cell is null or trim(first_cell) = '' then
                        continue;
                    end if;

                    parts := regexp_split_to_array(first_cell, '[/、,，]');
                    foreach part in array parts loop
                        part := trim(regexp_replace(regexp_replace(trim(part), '^[「『（(]+', ''), '[」』）)]+$', ''));
                        if part = '' then
                            continue;
                        end if;

                        insert into pos_item_variants (erp_code, spec, bore, color, image_url, sort_order)
                        values (
                            prod.erp_code,
                            case when axis_type = 'spec' then part else '' end,
                            case when axis_type = 'bore' then part else '' end,
                            case when axis_type = 'color' then part else '' end,
                            null,
                            0
                        )
                        on conflict on constraint pos_item_variants_key do nothing;
                    end loop;
                end loop;

                i := block_end + 1;
            else
                i := i + 1;
            end if;
        end loop;
    end loop;
end $$;

-- 執行完可以順便看一下結果：
select erp_code, spec, bore, color from pos_item_variants order by erp_code, spec, bore, color;
