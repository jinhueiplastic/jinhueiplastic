let allOrders = [];
let matchedOrders = [];

const statusMsg        = document.getElementById('status-msg');
const resultsContainer = document.getElementById('results-container');
const regionSelect     = document.getElementById('region-select');
const generateBtn      = document.getElementById('generate-btn');

async function loadRegions() {
    const { data, error } = await sb.from('customers').select('region');
    if (error) { console.error(error); return; }
    const regions = [...new Set((data || []).map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    regionSelect.innerHTML = '<option value="">請選擇區域…</option>' +
        regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
}

async function loadOrders() {
    const { data, error } = await sb
        .from('orders')
        .select('*, customers(name,phone,address,site_name,region), order_items(*)')
        .order('created_at', { ascending: false })
        .limit(1000);
    if (error) {
        resultsContainer.innerHTML = `<p class="text-red-600">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    allOrders = data || [];
}

function renderResults(orders) {
    if (!orders.length) {
        resultsContainer.innerHTML = `<p class="text-gray-400 text-center py-10">沒有符合的訂單</p>`;
        return;
    }
    resultsContainer.innerHTML = orders.map(o => {
        const items = o.order_items || [];
        const summary = items.map(it => {
            const variant = [it.spec, it.bore, it.color].filter(Boolean).join('/');
            const name = it.product_name_zh || it.product_erp_code || '';
            return `${escapeHtml(name)}${variant ? '（' + escapeHtml(variant) + '）' : ''} x${it.quantity}`;
        }).join('、');
        const c = o.customers || {};
        return `
        <div class="bg-white border rounded-lg p-4 mb-3">
            <p class="font-bold text-blue-700">${escapeHtml(o.order_no || '')}</p>
            <p class="text-sm text-gray-500">${new Date(o.created_at).toLocaleString('zh-TW')}</p>
            <p class="text-sm text-gray-700 mt-1">
                客戶：${escapeHtml(c.name || '（未知）')}${c.phone ? '　' + escapeHtml(c.phone) : ''}
                ${c.site_name ? '　工地：' + escapeHtml(c.site_name) : ''}
            </p>
            <p class="text-sm text-gray-600 mt-2">${summary || '（無商品明細）'}</p>
        </div>`;
    }).join('');
}

function applyFilter() {
    const region = regionSelect.value;
    const dateFrom = document.getElementById('q-date-from').value;
    const dateTo = document.getElementById('q-date-to').value;

    if (!region) {
        matchedOrders = [];
        statusMsg.textContent = '請先選擇區域';
        generateBtn.disabled = true;
        resultsContainer.innerHTML = '';
        return;
    }

    matchedOrders = allOrders.filter(o => {
        const c = o.customers;
        if (!c || (c.region || '').trim() !== region) return false;
        const orderDate = o.created_at ? o.created_at.slice(0, 10) : '';
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;
        return true;
    });

    statusMsg.textContent = `${region}：共 ${matchedOrders.length} 筆訂單`;
    generateBtn.disabled = matchedOrders.length === 0;
    renderResults(matchedOrders);
}

document.getElementById('search-btn').addEventListener('click', applyFilter);
regionSelect.addEventListener('change', applyFilter);

generateBtn.addEventListener('click', async () => {
    if (!matchedOrders.length) return;

    generateBtn.disabled = true;
    generateBtn.textContent = '產生中…';
    try {
        const entries = matchedOrders.map(o => ({
            order: o,
            customer: o.customers,
            items: o.order_items || [],
        }));
        const today = new Date().toISOString().slice(0, 10);
        await generateCombinedOrdersPdf(entries, `區域出貨單-${regionSelect.value}-${today}.pdf`);
    } catch (e) {
        alert('產生 PDF 失敗：' + e.message);
    } finally {
        generateBtn.disabled = matchedOrders.length === 0;
        generateBtn.textContent = '產生合併 PDF';
    }
});

async function initRegionForm() {
    statusMsg.textContent = '載入中…';
    await Promise.all([loadRegions(), loadOrders()]);
    statusMsg.textContent = '請先選擇區域';
}

initAdminAuth('region', initRegionForm);
