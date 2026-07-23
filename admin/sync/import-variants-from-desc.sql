-- 一次性：把所有商品中文說明（desc_zh）裡的表格自動解析成 POS 選項（彈性軸版）。
-- 每一欄各自是一個獨立的軸，軸的選項＝這一整個表格裡那一欄出現過的所有「不同」的值
-- （值裡如果用 / 、 , ， 分隔多個值，會再拆成好幾個獨立選項）。
--
-- 例如：
--   |型號|W|H|L|A排水孔位|備註|
--   |1030|10cm|3cm|30cm|正中心|附防臭水門|
--   |1045|10cm|3cm|45cm|正中心|附防臭水門|
--   |1060|10cm|3cm|60cm|11cm或正中心|附防臭水門|
-- 會變成：
--   型號選項：1030、1045、1060…
--   W選項：10cm（整欄都一樣，最後只會有這一個選項）
--   H選項：3cm（同上）
--   L選項：30cm、45cm、60cm…
--   A排水孔位選項：正中心、11cm或正中心（重複的值只會留一個）
--   備註選項：附防臭水門
-- 「只有一個選項時預設直接選起來」是 POS 下單畫面的行為，不用在這裡特別處理。
--
-- 只新增資料，不會刪除或覆蓋既有的 pos_item_variants 資料（包括已經手動在網頁上建立的選項/組合），
-- 可以重複執行，不會造成重複資料。執行完可以直接在「修改 POS 商品」頁面檢查結果。
--
-- 提醒：如果中文說明裡有「用 ^ 表示同上一列」這種不規則格式的表格（不是每欄都是獨立軸的表格），
-- 這支script不會特別去理解那種格式，跑完可能會多出一些奇怪的選項，手動去該商品的軸列表刪掉就好。

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

                header_count := coalesce(array_length(header_cells, 1), 0);

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

                        -- 每一欄各自是一個獨立的軸：這一欄在這個表格裡出現過的所有不同值都變成這個軸的選項
                        -- （某一欄全部列都填同一個值的話，這個軸最後就只會有一個選項）。
                        for k in 1..least(header_count, array_length(cells, 1)) loop
                            axis_name := header_cells[k];
                            if axis_name = '' or cells[k] is null or trim(cells[k]) = '' or trim(cells[k]) = '^' then
                                continue; -- ^ 是常見的「同上一列」標記，不是真正的值
                            end if;

                            -- 只有「整個表格只有 1 欄」的時候才用 / 、 , ， 拆成好幾個值
                            -- （這種表格通常是刻意在一格裡條列好幾個選項）；
                            -- 表格有 2 欄以上時，每一列已經是各自獨立的一筆資料，
                            -- 格子裡的頓號、逗號很可能只是普通文字的一部分（例如一段描述），
                            -- 不能亂拆，整格當一個值。
                            if header_count = 1 then
                                parts := regexp_split_to_array(cells[k], '[/、,，]');
                            else
                                parts := array[cells[k]];
                            end if;

                            foreach part in array parts loop
                                part := trim(regexp_replace(regexp_replace(trim(part), '^[「『（(]+', ''), '[」』）)]+$', ''));
                                if part = '' then
                                    continue;
                                end if;

                                insert into pos_item_variants (erp_code, axis_values, image_url, sort_order)
                                values (prod.erp_code, jsonb_build_object(axis_name, part), null, 0)
                                on conflict (erp_code, axis_values) do nothing;
                            end loop;
                        end loop;
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
