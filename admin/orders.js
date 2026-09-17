let allOrders = [];
let allCustomersForFilter = [];
let selectedRegionFilter = null; // null = 全部

// 訂單本身已經照 created_at 新到舊查詢回來，這裡只是額外提供「最舊在上面」的選項；
// 排序只影響畫面顯示順序，不影響查詢/篩選邏輯本身。
function sortOrders(orders) {
    const sorted = [...orders];
    const dir = document.getElementById('sort-select').value === 'created_asc' ? 1 : -1;
    sorted.sort((a, b) => dir * (new Date(a.created_at) - new Date(b.created_at)));
    return sorted;
}

const statusMsg         = document.getElementById('status-msg');
const resultsContainer  = document.getElementById('results-container');

function renderCustomerDatalist(customers) {
    const dl = document.getElementById('customer-datalist');
    if (!dl) return;
    const byName  = customers.map(c => `<option value="${escapeHtml(c.name)}">`).join('');
    const byPhone = customers.filter(c => c.phone)
        .map(c => `<option value="${escapeHtml(c.phone)}">${escapeHtml(c.name)}</option>`).join('');
    dl.innerHTML = byName + byPhone;
}

function renderRegionFilterTiles() {
    const container = document.getElementById('region-filter-tiles');
    if (!container) return;
    const regions = [...new Set(allCustomersForFilter.map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    const allBtn = `
        <button type="button" class="region-filter-btn${selectedRegionFilter ? '' : ' active'}" data-region="">
            全部
        </button>`;
    const regionBtns = regions.map(r => `
        <button type="button" class="region-filter-btn${selectedRegionFilter === r ? ' active' : ''}" data-region="${escapeHtml(r)}">
            ${escapeHtml(r)}
        </button>`).join('');

    container.innerHTML = allBtn + regionBtns;

    container.querySelectorAll('.region-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedRegionFilter = btn.dataset.region || null;
            renderRegionFilterTiles();
            applyFilters();
        });
    });
}

async function loadOrders() {
    statusMsg.textContent = '載入訂單中…';

    const [{ data, error }, { data: customerData, error: customerError }] = await Promise.all([
        sb.from('orders')
            .select('*, customers(name,phone,address,site_name,region,contact_person), order_items(*)')
            .order('created_at', { ascending: false })
            .limit(500),
        sb.from('customers').select('name,phone,region').order('name', { ascending: true }),
    ]);

    if (error) {
        statusMsg.textContent = '';
        resultsContainer.innerHTML = `<p class="text-red-600">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    if (customerError) console.error(customerError);

    allCustomersForFilter = customerData || [];
    renderCustomerDatalist(allCustomersForFilter);
    renderRegionFilterTiles();

    allOrders = data || [];
    statusMsg.textContent = `共 ${allOrders.length} 筆訂單（最多顯示近 500 筆）`;
    renderResults(allOrders);
}

function renderResults(unsortedOrders) {
    const orders = sortOrders(unsortedOrders);
    if (!orders.length) {
        resultsContainer.innerHTML = `<p class="text-gray-400 text-center py-10">沒有符合的訂單</p>`;
        return;
    }

    resultsContainer.innerHTML = orders.map(o => {
        const items = o.order_items || [];
        const c = o.customers || {};
        const nameLine = c.site_name ? `${c.name || ''}--${c.site_name}` : (c.name || '（未知客戶）');
        // 訂單日期（POS 下單挑的，可以補登/預先建立）跟建立日期（這筆訂單真正存進資料庫的
        // 時間，編輯訂單不會去動它）是兩回事，分開顯示。order_date 是舊資料還沒跑過遷移時的備援。
        const orderDateLabel = isoDateToRocLabel(o.order_date || (o.created_at ? o.created_at.slice(0, 10) : ''));
        const createdLabel = isoDateTimeToRocLabel(o.created_at);
        const creatorText = o.created_by_name || o.created_by_email;
        const itemsHtml = items.length
            ? items.map(orderItemLineHtml).join('')
            : `<p class="text-sm text-gray-400">（無商品明細）</p>`;

        return `
        <div class="bg-white border rounded-lg p-4 mb-3">
            <div class="flex items-center justify-between gap-2">
                ${c.region ? `<span class="region-badge">${escapeHtml(c.region)}</span>` : '<span></span>'}
                <p class="text-sm text-gray-500 whitespace-nowrap">${escapeHtml(orderDateLabel)}</p>
            </div>
            <div class="flex items-start justify-between gap-2 mt-2">
                <p class="text-lg font-bold text-gray-900">${escapeHtml(nameLine)}</p>
                <div class="text-right shrink-0">
                    <p class="text-sm text-gray-500 whitespace-nowrap">${escapeHtml(o.order_no || '')}</p>
                    ${createdLabel ? `<p class="text-xs text-gray-400 whitespace-nowrap">建立日期：${escapeHtml(createdLabel)}</p>` : ''}
                    ${creatorText ? `<p class="text-xs text-gray-400 whitespace-nowrap">建立者：${escapeHtml(creatorText)}</p>` : ''}
                </div>
            </div>
            <p class="text-sm text-gray-600 mt-1">電話：${escapeHtml(c.phone || '（無）')}</p>
            <p class="text-sm text-gray-600">地址：${escapeHtml(c.address || '（無）')}</p>
            <div class="mt-2 border-t pt-2">${itemsHtml}</div>
            <div class="flex justify-end gap-2 mt-3">
                <a href="/admin/pos.html?edit=${encodeURIComponent(o.id)}" class="px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100">編輯</a>
                <button data-id="${o.id}" class="pdf-btn px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100">下載 PDF</button>
                <button data-id="${o.id}" class="delete-btn px-3 py-1.5 text-sm rounded border border-red-200 text-red-600 bg-white hover:bg-red-50">刪除</button>
            </div>
        </div>`;
    }).join('');

    wireOrderItemThumbZoom(resultsContainer);

    resultsContainer.querySelectorAll('.pdf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = allOrders.find(o => String(o.id) === btn.dataset.id);
            generateOrderPdf(order, order.customers, order.order_items || []);
        });
    });

    resultsContainer.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const order = allOrders.find(o => String(o.id) === btn.dataset.id);
            if (!order) return;
            if (!confirm(`確定要刪除訂單 ${order.order_no} 嗎？此動作無法復原。`)) return;

            const { error } = await sb.from('orders').delete().eq('id', order.id);
            if (error) {
                alert('刪除失敗：' + error.message);
                return;
            }
            allOrders = allOrders.filter(o => o.id !== order.id);
            statusMsg.textContent = `共 ${allOrders.length} 筆訂單（最多顯示近 500 筆）`;
            renderResults(allOrders);
        });
    });
}

function applyFilters() {
    const orderNo   = document.getElementById('q-order-no').value.trim().toLowerCase();
    const customerQ = document.getElementById('q-customer').value.trim().toLowerCase();
    const productQ  = document.getElementById('q-product').value.trim().toLowerCase();
    const dateFrom  = minguoFieldsToIsoDate('q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd');
    const dateTo    = minguoFieldsToIsoDate('q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd');

    const filtered = allOrders.filter(o => {
        if (orderNo && !String(o.order_no || '').toLowerCase().includes(orderNo)) return false;

        if (selectedRegionFilter && (o.customers && o.customers.region || '').trim() !== selectedRegionFilter) {
            return false;
        }

        if (customerQ) {
            const name = String(o.customers && o.customers.name || '').toLowerCase();
            const phone = String(o.customers && o.customers.phone || '').toLowerCase();
            if (!name.includes(customerQ) && !phone.includes(customerQ)) return false;
        }

        if (productQ) {
            const items = o.order_items || [];
            const hit = items.some(it =>
                String(it.product_erp_code || '').toLowerCase().includes(productQ) ||
                String(it.product_name_zh || '').toLowerCase().includes(productQ)
            );
            if (!hit) return false;
        }

        // 用日期搜尋是搜「訂單日期」（POS 下單挑的），不是建立日期。
        const orderDate = o.order_date || (o.created_at ? o.created_at.slice(0, 10) : '');
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;

        return true;
    });

    renderResults(filtered);
}

document.getElementById('search-btn').addEventListener('click', applyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);

const ORDERS_DATE_FROM_IDS = ['q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd'];
const ORDERS_DATE_TO_IDS   = ['q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd'];
const ORDERS_ALL_DATE_IDS  = [...ORDERS_DATE_FROM_IDS, ...ORDERS_DATE_TO_IDS];

function ordersDateFieldsAllEmpty() {
    return ORDERS_ALL_DATE_IDS.every(id => !document.getElementById(id).value);
}

// 起（民國年/月/日）打完，迄自動帶入同一天，大部分時候都是查單一天，省得再打一次；
// 需要查一段區間的話，迄還是可以再手動改成別的日期——跟合併區域表單同一套邏輯。
ORDERS_DATE_FROM_IDS.forEach((fromId, i) => {
    const toId = ORDERS_DATE_TO_IDS[i];
    document.getElementById(fromId).addEventListener('input', () => {
        document.getElementById(toId).value = document.getElementById(fromId).value;
    });
});

// 查詢訂單預設還是顯示全部訂單，不像合併區域表單一進頁面就自動篩「今天」；
// 但只要點進日期格子、發現起訖兩組都還是空的，就先自動帶入今天的日期，方便直接從
// 「今天」開始改，不用從頭自己打一次完整的日期。點下去（或用鍵盤 Tab 切過來）也會把
// 格子文字整個選起來，直接打新的數字就會取代掉；按 Enter 直接等同按「查詢」。
ORDERS_ALL_DATE_IDS.forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', (e) => {
        if (ordersDateFieldsAllEmpty()) {
            fillTodayAsMinguo('q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd');
            fillTodayAsMinguo('q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd');
        }
        e.target.select();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyFilters();
        }
    });
});

// 「前天」「昨天」：把起訖兩組日期都填成同一天（只查那一天），按下去馬上查詢——
// 跟合併區域表單同一套邏輯。
function fillMinguoOffsetDays(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const yyy = d.getFullYear() - 1911;
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    ['q-date-from-yyy', 'q-date-to-yyy'].forEach(id => { document.getElementById(id).value = yyy; });
    ['q-date-from-mm', 'q-date-to-mm'].forEach(id => { document.getElementById(id).value = mm; });
    ['q-date-from-dd', 'q-date-to-dd'].forEach(id => { document.getElementById(id).value = dd; });
}

document.getElementById('date-yesterday-btn').addEventListener('click', () => {
    fillMinguoOffsetDays(1);
    applyFilters();
});
document.getElementById('date-day-before-yesterday-btn').addEventListener('click', () => {
    fillMinguoOffsetDays(2);
    applyFilters();
});

document.getElementById('reset-btn').addEventListener('click', () => {
    ['q-order-no', 'q-customer', 'q-product', 'q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd', 'q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd'].forEach(id => {
        document.getElementById(id).value = '';
    });
    selectedRegionFilter = null;
    renderRegionFilterTiles();
    renderResults(allOrders);
});

initScrollRestoration('orders');
initAdminAuth('orders', loadOrders);
