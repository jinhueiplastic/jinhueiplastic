let allOrders = [];
let matchedOrders = [];
let allRegions = [];
let selectedRegion = ''; // 預設就選「全部」，不用每次進頁面都自己先點一次

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

    regionTilesEl.innerHTML = regionTiles + allTile;

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
        .select('*, customers(name,phone,address,site_name,region,contact_person), order_items(*)')
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
        const c = o.customers || {};
        const nameLine = c.site_name ? `${c.name || ''}--${c.site_name}` : (c.name || '（未知客戶）');
        // 訂單日期（POS 下單挑的，可以補登/預先建立）跟建立日期（這筆訂單真正存進資料庫的
        // 時間，編輯訂單不會去動它）是兩回事，分開顯示。order_date 是舊資料還沒跑過遷移時的備援。
        const orderDateLabel = isoDateToRocLabel(o.order_date || (o.created_at ? o.created_at.slice(0, 10) : ''));
        const createdLabel = isoDateTimeToRocLabel(o.created_at);
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
                </div>
            </div>
            <p class="text-sm text-gray-600 mt-1">電話：${escapeHtml(c.phone || '（無）')}</p>
            <p class="text-sm text-gray-600">地址：${escapeHtml(c.address || '（無）')}</p>
            <div class="mt-2 border-t pt-2">${itemsHtml}</div>
        </div>`;
    }).join('');

    wireOrderItemThumbZoom(resultsContainer);
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
    const dateFrom = qDateFromPicker.getIso();
    const dateTo = qDateToPicker.getIso();

    matchedOrders = allOrders.filter(o => {
        const c = o.customers;
        if (region && (!c || (c.region || '').trim() !== region)) return false;
        // 用日期搜尋是搜「訂單日期」（POS 下單挑的），不是建立日期。
        const orderDate = o.order_date || (o.created_at ? o.created_at.slice(0, 10) : '');
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

// 起選好之後，迄自動帶入同一天，大部分時候都是查單一天，省得再選一次；
// 需要查一段區間的話，迄還是可以再手動改成別的日期。
const qDateFromPicker = initRocDatePicker('q-date-from', {
    allowClear: true,
    onChange: (iso) => qDateToPicker.setDate(iso),
});
const qDateToPicker = initRocDatePicker('q-date-to', { allowClear: true });

// 「前天」「昨天」：把起訖兩組日期都填成同一天（只查那一天），按下去馬上查詢，
// 不用自己手動改日期再按查詢——跟「查詢」按鈕一樣要求先選好區域。
function fillOffsetDays(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    qDateFromPicker.setDate(iso);
    qDateToPicker.setDate(iso);
}

document.getElementById('date-yesterday-btn').addEventListener('click', () => {
    fillOffsetDays(1);
    applyFilter();
});
document.getElementById('date-day-before-yesterday-btn').addEventListener('click', () => {
    fillOffsetDays(2);
    applyFilter();
});

generateBtn.addEventListener('click', async () => {
    if (!matchedOrders.length) return;

    generateBtn.disabled = true;
    generateBtn.textContent = '產生中…';
    try {
        // 畫面上的清單（matchedOrders）維持新到舊排序方便瀏覽，但合併 PDF 要照時間先後——
        // 舊的在前、新的接在後面，所以這裡另外複製一份排成正序，不動到原本的畫面順序。
        const sortedOrders = [...matchedOrders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const today = new Date().toISOString().slice(0, 10);
        const toEntry = (o) => ({ order: o, customer: o.customers, items: o.order_items || [] });

        if (selectedRegion === '') {
            // 「全部區域」：不能把不同區域的訂單混在一起排版，還是要分區域各自成一個區塊
            // （各自從新的一頁開始），區塊內部一樣照時間排序。沒有「未分類」客戶區域的話
            // 用「未分類」當分組名稱，跟客戶資訊頁的慣例一致。
            const regionsInOrder = [...new Set(sortedOrders.map(o => (o.customers && o.customers.region || '').trim() || '未分類'))]
                .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
            const groups = regionsInOrder.map(region => ({
                title: `${region}出貨清單－${today}`,
                entries: sortedOrders
                    .filter(o => ((o.customers && o.customers.region || '').trim() || '未分類') === region)
                    .map(toEntry),
            }));
            await generateCombinedOrdersPdfByGroup(groups, `區域出貨單-全部區域-${today}.pdf`);
        } else {
            const entries = sortedOrders.map(toEntry);
            await generateCombinedOrdersPdf(entries, `區域出貨單-${selectedRegion}-${today}.pdf`, `${selectedRegion}出貨清單－${today}`);
        }
    } catch (e) {
        alert('產生 PDF 失敗：' + e.message);
    } finally {
        generateBtn.disabled = matchedOrders.length === 0;
        generateBtn.textContent = '產生合併 PDF';
    }
});

async function initRegionForm() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    qDateFromPicker.setDate(todayIso);
    qDateToPicker.setDate(todayIso);

    statusMsg.textContent = '載入中…';
    await Promise.all([loadRegions(), loadOrders()]);
    renderRegionTiles();
    applyFilter(); // 預設選「全部」，載入完直接查一次今天的訂單，不用自己先點區域
}

initScrollRestoration('region');
initAdminAuth('region', initRegionForm);
