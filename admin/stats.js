let allOrders = [];
let filteredOrders = [];

const statusMsg = document.getElementById('status-msg');

async function loadOrders() {
    statusMsg.textContent = '載入中…';
    // 訂單筆數多的話一次查詢可能超過 Supabase 預設 1000 筆上限，用 fetchAllRows 分頁抓齊，
    // 不然統計數字看起來會少一截。
    const { data, error } = await fetchAllRows(() =>
        sb.from('orders')
            .select('*, customers(name, site_name, region), order_items(*)')
            .order('created_at', { ascending: true })
    );
    if (error) {
        statusMsg.textContent = '';
        document.getElementById('daily-stats-table').innerHTML = `<p class="text-red-600 text-sm">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    allOrders = data || [];
    applyFilter();
}

function applyFilter() {
    const dateFrom = minguoFieldsToIsoDate('q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd');
    const dateTo = minguoFieldsToIsoDate('q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd');

    filteredOrders = allOrders.filter(o => {
        const orderDate = o.created_at ? o.created_at.slice(0, 10) : '';
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;
        return true;
    });

    statusMsg.textContent = `共 ${filteredOrders.length} 筆訂單`;
    renderStats();
}

// 同一個分組（某一天／某個商品／某個區域）底下，數量要照單位分開加總——
// 「只」跟「箱」不能直接加在一起，混著顯示才不會誤導。
function addQuantity(unitTotals, unit, qty) {
    const key = unit || '（無單位）';
    unitTotals[key] = (unitTotals[key] || 0) + (Number(qty) || 0);
}

function unitTotalsLabel(unitTotals) {
    const entries = Object.entries(unitTotals).filter(([, qty]) => qty);
    if (!entries.length) return '（無）';
    return entries
        .sort((a, b) => b[1] - a[1])
        .map(([unit, qty]) => `${formatRatioNumber(qty)}${escapeHtml(unit)}`)
        .join('、');
}

function computeDailyStats(orders) {
    const byDate = new Map();
    orders.forEach(o => {
        const date = o.created_at ? o.created_at.slice(0, 10) : '';
        if (!date) return;
        if (!byDate.has(date)) byDate.set(date, { orderCount: 0, unitTotals: {} });
        const bucket = byDate.get(date);
        bucket.orderCount += 1;
        (o.order_items || []).forEach(it => addQuantity(bucket.unitTotals, it.unit, it.quantity));
    });
    // 舊到新排：由上往下看就是時間順序，跟合併 PDF 的排序邏輯一致。
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function computeProductStats(orders) {
    const byProduct = new Map();
    orders.forEach(o => {
        (o.order_items || []).forEach(it => {
            const key = it.product_erp_code || it.product_name_zh || '（未知商品）';
            if (!byProduct.has(key)) {
                byProduct.set(key, {
                    name: it.product_name_zh || it.product_erp_code || '（未知商品）',
                    erp: it.product_erp_code || '',
                    orderIds: new Set(),
                    unitTotals: {},
                });
            }
            const bucket = byProduct.get(key);
            bucket.orderIds.add(o.id);
            addQuantity(bucket.unitTotals, it.unit, it.quantity);
        });
    });
    // 出現在越多訂單裡的商品排越前面，比較常出貨的商品一眼就看得到。
    return [...byProduct.values()].sort((a, b) => b.orderIds.size - a.orderIds.size);
}

// 區域的出貨數量不能全部商品混在一起加總（不然看不出來是哪個商品出了多少），
// 改成每個商品各自一行：{商品名稱: {name, unitTotals}}，同一個商品底下再依單位分開加總。
function computeRegionStats(orders) {
    const byRegion = new Map();
    orders.forEach(o => {
        const region = ((o.customers && o.customers.region) || '').trim() || '未分類';
        if (!byRegion.has(region)) byRegion.set(region, { orderCount: 0, customerIds: new Set(), productTotals: new Map() });
        const bucket = byRegion.get(region);
        bucket.orderCount += 1;
        bucket.customerIds.add(o.customer_id);
        (o.order_items || []).forEach(it => {
            const key = it.product_erp_code || it.product_name_zh || '（未知商品）';
            if (!bucket.productTotals.has(key)) {
                bucket.productTotals.set(key, { name: it.product_name_zh || it.product_erp_code || '（未知商品）', unitTotals: {} });
            }
            addQuantity(bucket.productTotals.get(key).unitTotals, it.unit, it.quantity);
        });
    });
    return [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
}

function sumUnitTotals(unitTotals) {
    return Object.values(unitTotals).reduce((a, b) => a + b, 0);
}

// 一個區域底下每個商品各自一行「商品名稱 數量單位」，數量多的排前面。
function regionProductLinesHtml(productTotals) {
    const products = [...productTotals.values()];
    if (!products.length) return '（無）';
    return products
        .sort((a, b) => sumUnitTotals(b.unitTotals) - sumUnitTotals(a.unitTotals))
        .map(p => `${escapeHtml(p.name)} ${unitTotalsLabel(p.unitTotals)}`)
        .join('<br>');
}

function statsTableHtml(headers, rows) {
    if (!rows.length) return '<p class="text-sm text-gray-400">沒有符合的訂單</p>';
    return `
        <table class="w-full text-sm">
            <thead>
                <tr class="text-left text-gray-500 border-b">
                    ${headers.map(h => `<th class="py-1.5 pr-4 whitespace-nowrap">${escapeHtml(h)}</th>`).join('')}
                </tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

function renderDailyTable(rows) {
    const trs = rows.map(([date, s]) => `
        <tr class="border-b">
            <td class="py-1.5 pr-4 whitespace-nowrap">${escapeHtml(isoDateToRocLabel(date))}</td>
            <td class="py-1.5 pr-4">${s.orderCount}</td>
            <td class="py-1.5 pr-4">${unitTotalsLabel(s.unitTotals)}</td>
        </tr>`);
    document.getElementById('daily-stats-table').innerHTML = statsTableHtml(['日期', '訂單數', '出貨數量'], trs);
}

function renderProductTable(rows) {
    const trs = rows.map(r => `
        <tr class="border-b">
            <td class="py-1.5 pr-4">${escapeHtml(r.name)}</td>
            <td class="py-1.5 pr-4 text-gray-400">${escapeHtml(r.erp)}</td>
            <td class="py-1.5 pr-4">${r.orderIds.size}</td>
            <td class="py-1.5 pr-4">${unitTotalsLabel(r.unitTotals)}</td>
        </tr>`);
    document.getElementById('product-stats-table').innerHTML = statsTableHtml(['商品', '貨號', '訂單數', '出貨數量'], trs);
}

function renderRegionTable(rows) {
    const trs = rows.map(([region, s]) => `
        <tr class="border-b">
            <td class="py-1.5 pr-4 align-top">${escapeHtml(region)}</td>
            <td class="py-1.5 pr-4 align-top">${s.customerIds.size}</td>
            <td class="py-1.5 pr-4 align-top">${s.orderCount}</td>
            <td class="py-1.5 pr-4">${regionProductLinesHtml(s.productTotals)}</td>
        </tr>`);
    document.getElementById('region-stats-table').innerHTML = statsTableHtml(['區域', '地點數', '訂單數', '出貨數量'], trs);
}

function renderStats() {
    renderDailyTable(computeDailyStats(filteredOrders));
    renderProductTable(computeProductStats(filteredOrders));
    renderRegionTable(computeRegionStats(filteredOrders));
}

document.getElementById('search-btn').addEventListener('click', applyFilter);

document.getElementById('reset-btn').addEventListener('click', () => {
    ['q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd', 'q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd'].forEach(id => {
        document.getElementById(id).value = '';
    });
    applyFilter();
});

// 日期格子點下去就整格文字選起來，按 Enter 直接查詢——跟區域表單同一套習慣。
['q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd', 'q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', (e) => e.target.select());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyFilter();
        }
    });
});

async function initStatsPage() {
    await loadOrders();
}

initScrollRestoration('stats');
initAdminAuth('stats', initStatsPage);
