-- 一次性：把所有商品中文說明（desc_zh）裡的表格自動解析成 POS 選項（彈性軸版）。
-- 邏輯跟「修改 POS 商品」編輯頁「貼上表格解析並新增組合」按鈕一樣，這裡是一次幫全部商品跑完：
--   表格只有 1 欄 → 那一欄的表頭當軸名稱，每一列的值當這個軸的一個可點選項目
--                   （值裡如果用 / 、 , ， 分隔多個值，會自動拆成好幾個獨立選項）
--   表格有 2 欄以上 → 每一列是一筆「完整組合」，表頭當各軸名稱，那一列每一欄的值就是這筆組合各軸的值
--                    （例如型號｜W｜H｜L｜A排水孔位｜備註 這種表格，每一列會變成一筆 6 個軸都填好的組合；
--                    一列裡至少要有兩欄有值才會算一筆組合，只有一欄有值的列會被跳過）
--
-- 只新增資料，不會刪除或覆蓋既有的 pos_item_variants 資料（包括已經手動在網頁上建立的選項/組合），
-- 可以重複執行，不會造成重複資料。執行完可以直接在「修改 POS 商品」頁面檢查結果。

do $$
declare
    prod record;
    lines text[];
    n int;
    i int;
    j int;
    k int;
    trimmed text;
    block_start int;
    block_end int;
    header_cells text[];
    header_count int;
    data_line text;
    cells text[];
    axis_name text;
    part text;
    parts text[];
    values_obj jsonb;
    filled_count int;
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

                header_count := 0;
                if header_cells is not null then
                    select count(*) into header_count from unnest(header_cells) h where h <> '';
                end if;

                if header_count >= 1 then
                    for j in (block_start + 1)..block_end loop
                        data_line := lines[j];
                        if trim(data_line) ~ '^[|:\s-]+$' then
                            continue; -- markdown 分隔列（---）
                        end if;

                        select array_agg(trim(c))
                        into cells
                        from unnest(string_to_array(trim(both '|' from trim(data_line)), '|')) as c;

                        if cells is null or array_length(cells, 1) < 1 then
                            continue;
                        end if;

                        if header_count = 1 then
                            -- 單欄表格：這一欄的值當某個軸的可點選項目，用 / 、 , ， 拆成好幾個
                            axis_name := header_cells[1];
                            if axis_name = '' or cells[1] is null or trim(cells[1]) = '' then
                                continue;
                            end if;

                            parts := regexp_split_to_array(cells[1], '[/、,，]');
                            foreach part in array parts loop
                                part := trim(regexp_replace(regexp_replace(trim(part), '^[「『（(]+', ''), '[」』）)]+$', ''));
                                if part = '' then
                                    continue;
                                end if;

                                insert into pos_item_variants (erp_code, axis_values, image_url, sort_order)
                                values (prod.erp_code, jsonb_build_object(axis_name, part), null, 0)
                                on conflict (erp_code, axis_values) do nothing;
                            end loop;
                        else
                            -- 多欄表格：這一列是一筆完整組合，欄位名稱＝軸名稱
                            values_obj := '{}'::jsonb;
                            for k in 1..least(array_length(header_cells, 1), coalesce(array_length(cells, 1), 0)) loop
                                if header_cells[k] <> '' and cells[k] is not null and trim(cells[k]) <> '' then
                                    values_obj := values_obj || jsonb_build_object(header_cells[k], trim(cells[k]));
                                end if;
                            end loop;

                            select count(*) into filled_count from jsonb_object_keys(values_obj);
                            if filled_count >= 2 then
                                insert into pos_item_variants (erp_code, axis_values, image_url, sort_order)
                                values (prod.erp_code, values_obj, null, 0)
                                on conflict (erp_code, axis_values) do nothing;
                            end if;
                        end if;
                    end loop;
                end if;

                i := block_end + 1;
            else
                i := i + 1;
            end if;
        end loop;
    end loop;
end $$;

-- 執行完可以順便看一下結果：
select erp_code, axis_values, image_url, sort_order from pos_item_variants order by erp_code;
