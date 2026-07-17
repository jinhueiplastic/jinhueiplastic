let allOrders = [];
let matchedOrders = [];
let allRegions = [];
let selectedRegion = null;

const statusMsg        = document.getElementById('status-msg');
const resultsContainer = document.getElementById('results-container');
const regionTilesEl    = document.getElementById('region-tiles');
const generateBtn      = document.getElementById('generate-btn');

async function loadRegions() {
    const { data, error } = await sb.from('customers').select('region');
    if (error) { console.error(error); return; }
    allRegions = [...new Set((data || []).map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

// 跟 POS 下單頁一樣的區域按鈕（.region-tile），選好之後直接套用篩選。
// selectedRegion 用 null 代表「還沒選」，空字串 '' 代表「全部」按鈕（跟還沒選是兩回事）。
function renderRegionTiles() {
    const allTile = `
        <div class="region-tile${selectedRegion === '' ? ' active' : ''}" data-region="">
            <div class="region-tile-name">全部</div>
        </div>`;
    const regionTiles = allRegions.map(region => `
        <div class="region-tile${selectedRegion === region ? ' active' : ''}" data-region="${escapeHtml(region)}">
            <div class="region-tile-name">${escapeHtml(region)}</div>
        </div>`).join('');

    regionTilesEl.innerHTML = allTile + regionTiles;

    regionTilesEl.querySelectorAll('.region-tile').forEach(el => {
        el.addEventListener('click', () => {
            selectedRegion = el.dataset.region;
            renderRegionTiles();
            applyFilter();
        });
    });
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
                ${c.region ? '　區域：' + escapeHtml(c.region) : ''}
            </p>
            <p class="text-sm text-gray-600 mt-2">${summary || '（無商品明細）'}</p>
        </div>`;
    }).join('');
}

// 民國年/月/日轉西元 'YYYY-MM-DD'，任一欄空白或不是數字就回傳 null（代表這個界限不設限）。
function minguoFieldsToIsoDate(yyyId, mmId, ddId) {
    const yyy = Number(document.getElementById(yyyId).value);
    const mm  = Number(document.getElementById(mmId).value);
    const dd  = Number(document.getElementById(ddId).value);
    if (!yyy || !mm || !dd) return null;
    const gregorianYear = yyy + 1911;
    return `${gregorianYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function fillTodayAsMinguo(yyyId, mmId, ddId) {
    const today = new Date();
    document.getElementById(yyyId).value = today.getFullYear() - 1911;
    document.getElementById(mmId).value = today.getMonth() + 1;
    document.getElementById(ddId).value = today.getDate();
}

function applyFilter() {
    if (selectedRegion === null) {
        matchedOrders = [];
        statusMsg.textContent = '請先選擇區域';
        generateBtn.disabled = true;
        resultsContainer.innerHTML = '';
        return;
    }

    const region = selectedRegion; // '' 代表全部，不篩選區域
    const dateFrom = minguoFieldsToIsoDate('q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd');
    const dateTo = minguoFieldsToIsoDate('q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd');

    matchedOrders = allOrders.filter(o => {
        const c = o.customers;
        if (region && (!c || (c.region || '').trim() !== region)) return false;
        const orderDate = o.created_at ? o.created_at.slice(0, 10) : '';
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;
        return true;
    });

    const label = region || '全部區域';
    statusMsg.textContent = `${label}：共 ${matchedOrders.length} 筆訂單`;
    generateBtn.disabled = matchedOrders.length === 0;
    renderResults(matchedOrders);
}

document.getElementById('search-btn').addEventListener('click', applyFilter);

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
        const label = selectedRegion || '全部區域';
        await generateCombinedOrdersPdf(entries, `區域出貨單-${label}-${today}.pdf`, `${label}出貨清單－${today}`);
    } catch (e) {
        alert('產生 PDF 失敗：' + e.message);
    } finally {
        generateBtn.disabled = matchedOrders.length === 0;
        generateBtn.textContent = '產生合併 PDF';
    }
});

async function initRegionForm() {
    fillTodayAsMinguo('q-date-from-yyy', 'q-date-from-mm', 'q-date-from-dd');
    fillTodayAsMinguo('q-date-to-yyy', 'q-date-to-mm', 'q-date-to-dd');

    statusMsg.textContent = '載入中…';
    await Promise.all([loadRegions(), loadOrders()]);
    renderRegionTiles();
    statusMsg.textContent = '請先選擇區域';
}

initAdminAuth('region', initRegionForm);
