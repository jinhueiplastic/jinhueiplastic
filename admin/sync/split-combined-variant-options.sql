-- 一次性整理：把「一個規格/孔徑/顏色選項裡塞了好幾個值」的舊資料
-- （例如規格存成一整筆 4"、5"、6"，是在網頁批次新增支援 / 、 , ， 分隔之前存進去的）
-- 拆成一個值一筆，符合現在批次新增功能已經支援的分隔規則。
--
-- 只處理「只填一欄」的軸選項列（spec/bore/color 剛好只有一欄有值，且該值含分隔符號）；
-- 兩欄以上的組合照片列不受影響。拆出來的新選項會用 on conflict do nothing 避免跟既有選項重複。

do $$
declare
    r record;
    part text;
begin
    for r in
        select id, erp_code, spec, bore, color,
               case
                   when spec <> '' and bore = '' and color = '' then 'spec'
                   when bore <> '' and spec = '' and color = '' then 'bore'
                   when color <> '' and spec = '' and bore = '' then 'color'
                   else null
               end as axis_type,
               coalesce(nullif(spec, ''), nullif(bore, ''), nullif(color, '')) as raw_value
        from pos_item_variants
    loop
        if r.axis_type is null or r.raw_value !~ '[/、,，]' then
            continue;
        end if;

        for part in
            select distinct regexp_replace(regexp_replace(trim(x), '^[「『（(]+', ''), '[」』）)]+$', '')
            from regexp_split_to_table(r.raw_value, '[/、,，]') as x
        loop
            part := trim(part);
            if part = '' then
                continue;
            end if;

            insert into pos_item_variants (erp_code, spec, bore, color, image_url, sort_order)
            values (
                r.erp_code,
                case when r.axis_type = 'spec' then part else '' end,
                case when r.axis_type = 'bore' then part else '' end,
                case when r.axis_type = 'color' then part else '' end,
                null,
                0
            )
            on conflict on constraint pos_item_variants_key do nothing;
        end loop;

        delete from pos_item_variants where id = r.id;
    end loop;
end $$;
