let products = []; // 其實是 Supabase 的 pos_items 表資料，變數名稱沿用舊的
let customers = [];
let cart = [];
let cartCounter = 0;
let categoryCards = [];      // 官網「商品目錄」頁用的分類卡片：{ catId, name, image }
let categoryNameById = {};   // catId -> 中文分類顯示名稱
let variantOptionsByErp = {}; // erp_code -> { 軸名稱: [{value,image_url}], ... }，各軸各自有哪些可點選項目
let selectedVariant = {}; // 目前規格畫面上，用按鈕/打字選到的值，key 是軸名稱
// 哪些軸目前的值是系統自動幫忙選的（不是使用者自己點的）。自動選起來的值只是「方便」，
// 不能拿去限制別的軸還能選什麼——不然選完型號、規格跟長度被自動帶出來之後，
// 這兩個軸反過來把型號自己的其他選項也鎖住了，使用者會沒辦法換選別的型號。
let autoSelectedAxes = new Set();
let combosByErp = {}; // erp_code -> [{ values: {軸名:值,...}, image_url }]，同一列記錄好幾個軸的完整組合
let allUnits = []; // 所有出現過的單位（來自 pos_units），商品自己沒設定過單位時的備援清單
let unitsByErp = {}; // erp_code -> [{name, ratio}]，每個商品各自記住自己常用的單位跟換算比例
let selectedUnit = ''; // 目前規格畫面上，用按鈕點選的單位
let selectedRegionFilter = new URLSearchParams(location.search).get('region') || null; // 依區域篩選客戶，null＝全部
let allPickupTags = []; // 取貨標籤固定清單（來自 order_pickup_tags），跟 allUnits 是同一套「打字新增會記住」的邏輯
let selectedPickupTag = ''; // 目前用按鈕選到的取貨標籤；打字框有輸入的話以打字為準（跟規格軸同一套規則）

// 瀏覽狀態：categories（分類卡片）→ products（該分類/搜尋結果的商品卡片）→ variant（選規格數量）
let browseMode = 'categories';
let browseCategory = null; // 目前瀏覽的分類名稱；搜尋結果時為 null
let browseItems = [];      // products 模式下要顯示的商品清單
let browseProduct = null;  // variant 模式下選中的商品

// 點進分類／商品之前，各自畫面捲到哪裡了——按「← 返回」回去的時候用這個復原捲動位置，
// 不然每次都會跳回最上面，選購清單長的話很不方便。
let browseScrollY = { categories: 0, products: 0 };

function restoreScrollSoon(y) {
    // 等這次重畫完、瀏覽器把新內容的高度算出來之後才捲，不然畫面還是舊的高度，捲不到。
    requestAnimationFrame(() => window.scrollTo(0, y));
}

const newCustomerToggle  = document.getElementById('new-customer-toggle');
const newCustomerPanel   = document.getElementById('new-customer-panel');
const searchInput        = document.getElementById('product-search-input');
const homeBtn            = document.getElementById('browse-home-btn');
const backBtn            = document.getElementById('browse-back-btn');
const breadcrumb         = document.getElementById('browse-breadcrumb');
const browseArea         = document.getElementById('browse-area');
const cartContainer      = document.getElementById('cart-container');
const resultBanner       = document.getElementById('result-banner');
const saveOrderBtn       = document.getElementById('save-order-btn');

async function initPos() {
    // POS 只從 pos_items 拿商品（POS 可下單商品的子集合，跟 products/官網完全分開的一張表，
    // 從 Google Sheet 的「POS items」分頁同步過來），不是 products。
    const [{ data: productData, error: pErr }, { data: customerData, error: cErr }, { data: catData, error: catErr }, { data: variantData, error: vErr }, { data: unitData, error: uErr }, { data: itemUnitData, error: iuErr }, { data: tagData, error: tagErr }] = await Promise.all([
        // row_index 是 Google Sheet「POS items」分頁同步過來的列順序，讓同分類底下的商品
        // 排列跟 Sheet 上到下的順序一致；沒跑過同步、手動新增的商品 row_index 預設 0，
        // 排在同分類最前面。
        // 只抓上架中的商品——下架的商品不該讓人在這裡選到、下單。
        sb.from('pos_items').select('*').eq('is_active', true).order('category_name_zh', { ascending: true }).order('row_index', { ascending: true }).order('erp_code', { ascending: true }),
        sb.from('customers').select('*').order('name', { ascending: true }),
        sb.from('site_content').select('*').eq('page', 'Product Catalog').order('row_index', { ascending: true }),
        // pos_item_variants 累積很多商品的規格資料後很容易超過 Supabase 一次查詢 1000 筆的上限，
        // 用 fetchAllRows 分頁抓齊，不然新增的選項排在後面的話會抓不到、POS 下單看起來就像沒存到。
        // 完整組合的 sort_order 一律是 0，全系統的組合資料筆數一多，同一個值綁著大量列，
        // 資料庫對「平手」的列不保證每次查詢順序都一樣——分頁查詢時可能漏掉某幾頁夾在中間的列。
        // 加上 id 當第二個排序依據，讓每次查詢的順序固定下來，分頁才不會漏資料。
        fetchAllRows(() => sb.from('pos_item_variants').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true })),
        sb.from('pos_units').select('*').order('sort_order', { ascending: true }),
        sb.from('pos_item_units').select('*').order('sort_order', { ascending: true }),
        sb.from('order_pickup_tags').select('*').order('sort_order', { ascending: true }),
    ]);
    if (pErr) console.error(pErr);
    if (cErr) console.error(cErr);
    if (catErr) console.error(catErr);
    if (vErr) console.error(vErr);
    if (uErr) console.error(uErr);
    if (iuErr) console.error(iuErr);
    if (tagErr) console.error(tagErr);
    products = productData || [];
    customers = customerData || [];
    allUnits = (unitData || []).map(u => u.name);
    allPickupTags = (tagData || []).map(t => t.name);

    unitsByErp = {};
    (itemUnitData || []).forEach(u => {
        if (!unitsByErp[u.erp_code]) unitsByErp[u.erp_code] = [];
        unitsByErp[u.erp_code].push({ name: u.name, ratio: Number(u.ratio) || 1 });
    });

    // pos_item_variants 一列可能是「單一選項按鈕」（只填一個軸）
    // 或「完整組合」（填兩個以上的軸，可以只是資訊、也可以帶實際照片），兩種都從同一份資料算出來。
    // 軸名稱完全自訂，不再限定規格/孔徑/顏色。
    variantOptionsByErp = {};
    combosByErp = {};
    (variantData || []).forEach(v => {
        const entries = Object.entries(v.axis_values || {}).filter(([, val]) => val);
        if (!entries.length) return;

        if (entries.length === 1) {
            const [name, value] = entries[0];
            if (!variantOptionsByErp[v.erp_code]) variantOptionsByErp[v.erp_code] = {};
            if (!variantOptionsByErp[v.erp_code][name]) variantOptionsByErp[v.erp_code][name] = [];
            variantOptionsByErp[v.erp_code][name].push({ value, image_url: v.image_url });
        } else {
            if (!combosByErp[v.erp_code]) combosByErp[v.erp_code] = [];
            combosByErp[v.erp_code].push({ values: v.axis_values, image_url: v.image_url, is_disabled: !!v.is_disabled, unit_ratios: v.unit_ratios || {} });
        }
    });

    // 跟官網「商品目錄」頁用同一份分類卡片資料（site_content，page = Product Catalog）：
    // row_key 含 categories 的列才是分類卡片，link 欄位是拿來比對 products.category_name_zh 的識別碼，
    // image 欄位是官網那邊已經放好的分類封面圖。
    categoryCards = (catData || [])
        .filter(r => String(r.row_key || '').toLowerCase().includes('categories') && r.chinese)
        .map(r => ({ catId: r.link || '', name: r.chinese || '', image: r.image || '' }));
    categoryNameById = {};
    categoryCards.forEach(c => { categoryNameById[c.catId] = c.name; });

    renderRegionTiles();
    renderRegionDatalist();
    renderPickupTagTiles();
    initOrderDateField();

    cart = [];
    browseMode = 'categories';
    browseCategory = null;
    renderBrowseArea();
    renderCart();
    renderCartCustomerInfo(null);

    setupLeaveGuards();
}

// 購物車裡還有東西時，離開這頁（點導覽列、關分頁、重新整理、打網址列）都先提醒一下，
// 避免手滑放棄一張還沒儲存的訂單。
let leavingConfirmed = false; // 點導覽列時已經跳過一次自訂確認了，避免瀏覽器 beforeunload 再跳第二次

function setupLeaveGuards() {
    document.querySelectorAll('.admin-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            if (cart.length > 0) {
                if (confirm('目前還有已選購但尚未儲存的商品，離開這頁會放棄這張訂單，確定要離開嗎？')) {
                    leavingConfirmed = true;
                } else {
                    e.preventDefault();
                }
            }
        });
    });

    // 關分頁/重新整理/直接改網址這幾種瀏覽器沒辦法讓我們自訂文字，
    // 只會跳出瀏覽器自己那句制式提示，但至少會攔下來讓使用者確認一次。
    // 如果是點導覽列且已經確認過（leavingConfirmed），這裡就不用再問一次。
    window.addEventListener('beforeunload', (e) => {
        if (cart.length > 0 && !leavingConfirmed) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

// 每個區域都有自己的網址（?region=xxx），方便直接分享/加書籤某個區域的下單畫面，
// 瀏覽器上一頁/下一頁也能正確切換。
function setRegionInUrl(region) {
    const params = new URLSearchParams(location.search);
    if (region) params.set('region', region); else params.delete('region');
    const query = params.toString();
    history.pushState({}, '', location.pathname + (query ? '?' + query : ''));
}

window.addEventListener('popstate', () => {
    selectedRegionFilter = new URLSearchParams(location.search).get('region') || null;
    renderRegionTiles();
    deselectCustomer();
});

function renderRegionTiles() {
    const container = document.getElementById('region-tiles');
    const regions = [...new Set(customers.map(c => (c.region || '').trim() || '未分類'))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    const allTile = `
        <div class="region-tile${selectedRegionFilter ? '' : ' active'}" data-region="">
            <div class="region-tile-name">全部客戶</div>
        </div>`;
    const regionTiles = regions.map(region => `
        <div class="region-tile${selectedRegionFilter === region ? ' active' : ''}" data-region="${escapeHtml(region)}">
            <div class="region-tile-name">${escapeHtml(region)}</div>
        </div>`).join('');

    container.innerHTML = regionTiles + allTile;

    container.querySelectorAll('.region-tile').forEach(el => {
        el.addEventListener('click', () => {
            selectedRegionFilter = el.dataset.region || null;
            setRegionInUrl(selectedRegionFilter);
            renderRegionTiles();
            deselectCustomer();
        });
    });
}

function renderRegionDatalist() {
    const regionList = document.getElementById('nc-region-datalist');
    const regions = [...new Set(customers.map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    regionList.innerHTML = regions.map(r => `<option value="${escapeHtml(r)}">`).join('');
}

// 取貨標籤：固定清單（自取／放車自取／明早自取…）用按鈕點，也可以直接打字輸入清單以外的
// 值——跟規格軸選擇是同一套規則（點按鈕的話清掉打字框；打字的話按鈕自動取消選取，
// 以打字為準，不會兩邊同時生效搞不清楚）。選填，不選也可以送出訂單。
function renderPickupTagTiles() {
    const container = document.getElementById('pickup-tag-tiles');
    container.innerHTML = allPickupTags.map(name => `
        <button type="button" class="variant-tile pickup-tag-tile${selectedPickupTag === name ? ' selected' : ''}" data-value="${escapeHtml(name)}">
            <span>${escapeHtml(name)}</span>
        </button>`).join('');

    container.querySelectorAll('.pickup-tag-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.value;
            selectedPickupTag = (selectedPickupTag === value) ? '' : value; // 再點一次取消選取
            container.querySelectorAll('.pickup-tag-tile').forEach(b => {
                b.classList.toggle('selected', b.dataset.value === selectedPickupTag);
            });
            document.getElementById('pickup-tag-text-input').value = '';
        });
    });
}

document.getElementById('pickup-tag-text-input').addEventListener('input', (e) => {
    if (e.target.value.trim() && selectedPickupTag) {
        selectedPickupTag = '';
        document.querySelectorAll('.pickup-tag-tile').forEach(b => b.classList.remove('selected'));
    }
});

// 目前選到的取貨標籤：按鈕優先，沒按按鈕才看有沒有打字；都沒有就回傳空字串（選填欄位）。
function currentPickupTag() {
    if (selectedPickupTag) return selectedPickupTag;
    return document.getElementById('pickup-tag-text-input').value.trim();
}

function resetPickupTag() {
    selectedPickupTag = '';
    document.getElementById('pickup-tag-text-input').value = '';
    document.querySelectorAll('.pickup-tag-tile').forEach(b => b.classList.remove('selected'));
}

// 打了新標籤但不在固定清單裡的話，訂單存檔成功後順便學起來，下次就有按鈕可以直接點
// （跟 learnNewUnits 是同一套「保險機制」）。
async function learnNewPickupTag(tag) {
    if (!tag || allPickupTags.includes(tag)) return;
    const { error } = await sb.from('order_pickup_tags').insert({ name: tag, sort_order: allPickupTags.length });
    if (error) { console.error('自動學習取貨標籤失敗：', error); return; }
    allPickupTags.push(tag);
    renderPickupTagTiles();
}

// ===== 客戶搜尋（即時打字篩選，取代原本的下拉選單） =====
let selectedCustomerId = '';
const customerSearchInput   = document.getElementById('customer-search-input');
const customerSearchResults = document.getElementById('customer-search-results');

// 客戶下拉選單／搜尋框裡顯示的名稱：有工地名稱的話「公司--工地」，沒有的話就只顯示公司名稱。
function customerListLabel(c) {
    return c.site_name ? `${c.name}--${c.site_name}` : c.name;
}

function customersInCurrentRegion() {
    return selectedRegionFilter
        ? customers.filter(c => ((c.region || '').trim() || '未分類') === selectedRegionFilter)
        : customers;
}

function renderCustomerSearchResults(query) {
    const q = query.trim().toLowerCase();
    const pool = customersInCurrentRegion();
    const matches = q
        ? pool.filter(c => [c.name, c.phone, c.site_name].some(v => String(v || '').toLowerCase().includes(q)))
        : pool;
    const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 30);

    if (!sorted.length) {
        customerSearchResults.innerHTML = '<div class="customer-search-empty">沒有符合的客戶</div>';
    } else {
        customerSearchResults.innerHTML = sorted.map(c => `
            <div class="customer-search-item" data-id="${c.id}">
                <div class="font-medium">${escapeHtml(customerListLabel(c))}</div>
                <div class="text-xs text-gray-400">${escapeHtml(c.phone || '')}${c.region ? '　' + escapeHtml(c.region) : ''}</div>
            </div>`).join('');
        customerSearchResults.querySelectorAll('.customer-search-item').forEach(el => {
            // mousedown（而不是 click）才能搶在 input 的 blur 事件之前生效
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectCustomer(el.dataset.id);
            });
        });
    }
    customerSearchResults.classList.remove('hidden');
}

function renderCartCustomerInfo(c) {
    const el = document.getElementById('cart-customer-info');
    el.classList.remove('hidden');
    if (!c) {
        el.innerHTML = `<p class="text-sm text-gray-400">尚未選擇客戶</p>`;
        return;
    }
    el.innerHTML = `
        <p class="text-sm text-gray-700">客戶：${escapeHtml(c.name || '')}　工地：${escapeHtml(c.site_name || '（無）')}</p>
        <p class="text-lg font-bold text-gray-900 mt-1">區域：${escapeHtml(c.region || '（無）')}</p>
        <p class="text-xs text-gray-500 mt-1">地址：${escapeHtml(c.address || '（無）')}</p>
        <p class="text-xs text-gray-500">電話：${escapeHtml(c.phone || '（無）')}</p>
    `;
}

function selectCustomer(id) {
    selectedCustomerId = id;
    const c = customers.find(x => String(x.id) === String(id));
    // 搜尋框裡還是放純公司名稱（不是「公司--工地」），不然選完之後如果又點進這個框，
    // 會拿「公司--工地」這串完整文字去比對，反而搜不到任何客戶，要先手動刪字才行。
    customerSearchInput.value = c ? c.name : '';
    customerSearchResults.classList.add('hidden');
    renderCartCustomerInfo(c);
}

function deselectCustomer() {
    selectedCustomerId = '';
    customerSearchInput.value = '';
    customerSearchResults.classList.add('hidden');
    renderCartCustomerInfo(null);
}

customerSearchInput.addEventListener('input', () => {
    selectedCustomerId = ''; // 還在打字，代表還沒真正選定
    renderCustomerSearchResults(customerSearchInput.value);
});
customerSearchInput.addEventListener('focus', () => {
    renderCustomerSearchResults(customerSearchInput.value);
});
customerSearchInput.addEventListener('blur', () => {
    setTimeout(() => customerSearchResults.classList.add('hidden'), 100);
});

newCustomerToggle.addEventListener('click', () => {
    const opening = newCustomerPanel.classList.contains('hidden');
    newCustomerPanel.classList.toggle('hidden');
    // 如果目前有用區域篩選客戶，新增客戶就順便幫忙把「區域」填好，不用自己再打一次；
    // 「未分類」是給沒填區域的客戶用的特殊分類名稱，不是真的區域值，不用帶進去。
    // 每次打開都重新照目前的篩選狀態設定，不要留著上次沒存就關掉的舊內容。
    if (opening) {
        const prefillRegion = (selectedRegionFilter && selectedRegionFilter !== '未分類') ? selectedRegionFilter : '';
        document.getElementById('nc-region').value = prefillRegion;
    }
});

document.getElementById('nc-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('nc-name').value.trim();
    if (!name) { alert('請輸入客戶名稱'); return; }
    const payload = {
        name,
        site_name: document.getElementById('nc-site-name').value.trim(),
        region: document.getElementById('nc-region').value.trim(),
        address: document.getElementById('nc-address').value.trim(),
        phone: document.getElementById('nc-phone').value.trim(),
    };
    const { data, error } = await sb.from('customers').insert(payload).select().single();
    if (error) { alert('新增客戶失敗：' + error.message); return; }

    customers.push(data);
    customers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    selectedRegionFilter = null; // 清掉篩選，確保新客戶（不管什麼區域）一定看得到
    setRegionInUrl(null);
    renderRegionTiles();
    renderRegionDatalist();
    selectCustomer(data.id);
    newCustomerPanel.classList.add('hidden');
    ['nc-name', 'nc-site-name', 'nc-region', 'nc-address', 'nc-phone'].forEach(id => { document.getElementById(id).value = ''; });
});

// ===== 商品瀏覽：目錄 → 商品圖片 → 規格 =====

function thumbOf(p) {
    return String((p && p.image_url) || '').split(',')[0].trim();
}

function groupProductsByCategory() {
    const groups = new Map();
    products.forEach(p => {
        const cat = (p.category_name_zh || '').trim() || '未分類';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(p);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
}

// 有設定「下單名稱」就用那個，沒有的話退回中文品名——POS 下單畫面上顯示商品名稱的地方都用這個。
function orderDisplayName(p) {
    return (p.order_display_name || '').trim() || p.name_zh || '';
}

function productMatches(p, q) {
    const query = q.toLowerCase();
    return String(p.erp_code || '').toLowerCase().includes(query)
        || String(p.name_zh || '').toLowerCase().includes(query)
        || String(p.name_en || '').toLowerCase().includes(query)
        || String(p.order_display_name || '').toLowerCase().includes(query);
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) {
        browseMode = 'categories';
        renderBrowseArea();
        return;
    }
    browseMode = 'products';
    browseCategory = null;
    browseItems = products.filter(p => productMatches(p, q));
    renderBrowseArea();
});

backBtn.addEventListener('click', () => {
    let restoreY;
    if (browseMode === 'variant') {
        browseMode = 'products';
        restoreY = browseScrollY.products;
    } else {
        browseMode = 'categories';
        searchInput.value = '';
        restoreY = browseScrollY.categories;
    }
    renderBrowseArea();
    restoreScrollSoon(restoreY);
});

homeBtn.addEventListener('click', () => {
    browseMode = 'categories';
    browseCategory = null;
    searchInput.value = '';
    renderBrowseArea();
    restoreScrollSoon(0); // 「主分類」是重新開始瀏覽，回到最上面才看得到完整的分類列表
});

function renderCategoryGridHtml() {
    const groups = groupProductsByCategory();
    const countByCat = new Map(groups.map(([cat, items]) => [cat, items.length]));

    // 官網「商品目錄」頁的分類卡片（有真正的封面圖），只顯示底下真的有商品的分類。
    const curated = categoryCards
        .map(c => ({ cat: c.catId, name: c.name, image: c.image, count: countByCat.get(c.catId) || 0 }))
        .filter(c => c.count > 0);

    // 萬一有商品的分類沒被收進官網那份分類卡片清單，還是要讓 POS 找得到，
    // 用該分類第一項商品的照片頂著當封面圖。
    const coveredIds = new Set(curated.map(c => c.cat));
    const extra = groups
        .filter(([cat]) => !coveredIds.has(cat))
        .map(([cat, items]) => ({ cat, name: cat, image: thumbOf(items[0]), count: items.length }));

    const cards = [...curated, ...extra];
    if (!cards.length) return `<p class="text-gray-400 text-center py-10">目前沒有商品資料</p>`;

    return `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">` +
        cards.map(c => `
            <div class="category-card cursor-pointer" data-cat="${escapeHtml(c.cat)}">
                <div class="category-img-container">
                    <img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" style="background:#f3f4f6;">
                </div>
                <div class="p-3 text-center bg-white border-t">
                    <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(c.name)}</h4>
                    <p class="text-xs text-gray-400">${c.count} 項</p>
                </div>
            </div>`).join('') +
        `</div>`;
}

function renderProductGridHtml(items) {
    if (!items.length) return `<p class="text-gray-400 text-center py-10">沒有符合的商品</p>`;
    return `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">` +
        items.map(p => `
            <div class="category-card cursor-pointer" data-erp="${escapeHtml(p.erp_code)}">
                <div class="category-img-container">
                    <img src="${escapeHtml(thumbOf(p))}" alt="${escapeHtml(orderDisplayName(p))}" style="background:#f3f4f6;">
                </div>
                <div class="p-3 text-center bg-white border-t">
                    <p class="text-xs text-blue-600 font-bold mb-0.5">${escapeHtml(p.erp_code || '')}</p>
                    <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(orderDisplayName(p))}</h4>
                </div>
            </div>`).join('') +
        `</div>`;
}

// 這個商品目前有哪些「可以直接點選」的軸（有單一選項按鈕的軸；只出現在完整組合裡、
// 沒有自己獨立選項的軸——例如型號帶出來的 W/H/L——不會變成按鈕，而是選到符合的組合時用資訊列顯示）。
function productAxisNames(product) {
    const opts = variantOptionsByErp[product.erp_code];
    return opts ? Object.keys(opts) : [];
}

// 有選項的話畫成可以直接點的按鈕，下面一律都留一個打字輸入框，可以輸入清單以外的值
// （選了按鈕又打字，以打字的為準；打字後按鈕會自動取消選取，避免兩邊同時生效搞不清楚）。
function variantFieldHtml(axisName, product) {
    const options = (variantOptionsByErp[product.erp_code] && variantOptionsByErp[product.erp_code][axisName]) || [];

    const tilesHtml = options.length ? `
        <div class="flex flex-wrap gap-2 mb-2">
            ${options.map(o => `
                <button type="button" class="variant-tile" data-axis="${escapeHtml(axisName)}" data-value="${escapeHtml(o.value)}">
                    ${o.image_url ? `<img src="${escapeHtml(o.image_url)}" alt="${escapeHtml(o.value)}">` : ''}
                    <span>${escapeHtml(o.value)}</span>
                </button>`).join('')}
        </div>` : '';

    return `
        <div>
            <label class="field-label">${escapeHtml(axisName)}</label>
            ${tilesHtml}
            <input type="text" class="field-input variant-text-input" data-axis="${escapeHtml(axisName)}" placeholder="${options.length ? '或直接輸入其他值' : '尚無選項，可直接輸入'}">
        </div>`;
}

// 單位是每個商品各自記住的清單（跟規格/孔徑/顏色分開），
// 按鈕選或直接打新的都可以，新增的會馬上存進 pos_units，之後就一直有這個按鈕可以點。
// 還沒設定「下單名稱」、目前是靠中文品名頂著顯示的話，讓它可以直接點擊設定；
// 已經有「下單名稱」的話就是純文字，要改名請到「修改 POS 商品」頁面改。
function variantProductNameHtml(p) {
    const displayName = orderDisplayName(p);
    if ((p.order_display_name || '').trim()) {
        return `<h4 class="font-bold text-lg text-gray-800">${escapeHtml(displayName)}</h4>`;
    }
    return `<button type="button" id="variant-name-edit-btn" class="font-bold text-lg text-gray-800 text-left hover:underline hover:text-blue-600" title="點一下設定下單名稱">${escapeHtml(displayName)} ✎</button>`;
}

async function editProductOrderDisplayName(p) {
    const raw = prompt('設定「下單名稱」（POS 下單／查詢訂單／區域表單都會改用這個顯示；不填的話繼續用中文品名）：', p.name_zh || '');
    if (raw === null) return;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const { error } = await sb.from('pos_items').update({ order_display_name: trimmed }).eq('id', p.id);
    if (error) { alert('設定失敗：' + error.message); return; }

    p.order_display_name = trimmed;
    const wrap = document.getElementById('variant-product-name-wrap');
    if (wrap) wrap.innerHTML = variantProductNameHtml(p);
}

// 跟「修改 POS 商品」（admin.js）同一套規則：值前後的括號是排版習慣加的，不是值真正的一部分，
// 拆開多個值的時候先去掉；用 / 、 , ， 其中一種分隔就能一次輸入多個值。
function stripWrappingBrackets(v) {
    const pairs = { '（': '）', '(': ')', '「': '」', '『': '』' };
    const first = v[0];
    const last = v[v.length - 1];
    if (v.length >= 2 && pairs[first] === last) {
        const inner = v.slice(1, -1);
        const opens = (inner.match(/[（(「『]/g) || []).length;
        const closes = (inner.match(/[）)」』]/g) || []).length;
        if (opens === closes) return inner.trim();
    }
    return v;
}

function splitBulkValues(text) {
    return text.split(/[/、,，]/)
        .map(v => stripWrappingBrackets(v.trim()).trim())
        .filter(Boolean);
}

// 「+ 新增規格軸」：不用跑去「修改 POS 商品」，在下單畫面就能順便把這個商品的軸建好——
// 主要是給剛用「+ 新增商品」建的新商品用（還沒有任何軸），也可以用來幫既有商品多加一個軸。
// 新增的軸/選項直接存進 pos_item_variants（不像修改 POS 商品那邊要按最下面「儲存」才生效），
// 跟 POS 下單其他「馬上存檔」的操作（例如新單位）是同一套習慣。
function newAxisPanelHtml() {
    return `
        <div class="border-t pt-3 mt-1">
            <button type="button" id="new-axis-toggle" class="text-xs text-blue-600 hover:underline">+ 新增規格軸</button>
            <div id="new-axis-panel" class="hidden flex flex-wrap gap-2 items-end mt-2">
                <div class="flex-1 min-w-[8rem]">
                    <label class="field-label">軸名稱</label>
                    <input type="text" id="na-name-input" class="field-input" placeholder="例如：規格、顏色">
                </div>
                <div class="flex-1 min-w-[8rem]">
                    <label class="field-label">值（用 / 分隔，可一次加多個）</label>
                    <input type="text" id="na-value-input" class="field-input" placeholder="例如 1/2/3">
                </div>
                <button type="button" id="na-add-btn" class="px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100 whitespace-nowrap">新增</button>
            </div>
            <p id="na-status" class="text-xs text-gray-400 mt-1"></p>
        </div>`;
}

function renderVariantFieldsHtml(p) {
    return productAxisNames(p).map(name => variantFieldHtml(name, p)).join('');
}

function renderVariantPickerHtml(p) {
    return `
        <div class="flex gap-4 flex-col sm:flex-row">
            <img id="variant-preview-img" src="${escapeHtml(thumbOf(p))}" alt=""
                 style="width:140px;height:140px;object-fit:cover;flex-shrink:0;background:#f3f4f6;"
                 class="rounded-lg border">
            <div class="flex-1">
                <p class="text-xs text-blue-600 font-bold">${escapeHtml(p.erp_code || '')}</p>
                <div id="variant-product-name-wrap" class="mb-3">${variantProductNameHtml(p)}</div>
                <div class="space-y-3">
                    <div id="variant-fields-wrap">${renderVariantFieldsHtml(p)}</div>
                    ${newAxisPanelHtml()}
                    <div class="flex flex-wrap items-end gap-2">
                        <div>
                            <label class="field-label">數量</label>
                            <input type="number" id="variant-qty" class="field-input" style="width:4.5rem;" min="1" value="1">
                        </div>
                        <div id="unit-tiles" class="flex flex-wrap items-center gap-2"></div>
                    </div>
                    <p id="unit-ratio-hint" class="text-xs text-gray-400"></p>
                </div>
                <button type="button" id="add-to-cart-btn" class="mt-4 px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
                    加入已選購商品
                </button>
            </div>
        </div>`;
}

function renderBrowseArea() {
    if (browseMode === 'categories') {
        homeBtn.classList.add('hidden');
        backBtn.classList.add('hidden');
        breadcrumb.classList.add('hidden');
        browseArea.innerHTML = renderCategoryGridHtml();
        browseArea.querySelectorAll('[data-cat]').forEach(el => {
            el.addEventListener('click', () => {
                browseScrollY.categories = window.scrollY;
                browseCategory = el.dataset.cat;
                browseItems = products.filter(p => (p.category_name_zh || '').trim() === browseCategory);
                browseMode = 'products';
                renderBrowseArea();
            });
        });
        return;
    }

    if (browseMode === 'products') {
        homeBtn.classList.remove('hidden');
        backBtn.classList.remove('hidden');
        breadcrumb.classList.remove('hidden');
        breadcrumb.textContent = browseCategory
            ? `分類：${categoryNameById[browseCategory] || browseCategory}`
            : `搜尋結果（${browseItems.length}）`;
        browseArea.innerHTML = renderProductGridHtml(browseItems);
        browseArea.querySelectorAll('[data-erp]').forEach(el => {
            el.addEventListener('click', () => {
                browseScrollY.products = window.scrollY;
                browseProduct = products.find(p => p.erp_code === el.dataset.erp);
                browseMode = 'variant';
                renderBrowseArea();
            });
        });
        return;
    }

    if (browseMode === 'variant' && browseProduct) {
        homeBtn.classList.remove('hidden');
        backBtn.classList.remove('hidden');
        breadcrumb.classList.remove('hidden');
        breadcrumb.textContent = (browseCategory ? `分類：${categoryNameById[browseCategory] || browseCategory}　` : '') + `商品：${orderDisplayName(browseProduct) || browseProduct.erp_code}`;
        browseArea.innerHTML = renderVariantPickerHtml(browseProduct);
        wireVariantPicker(browseProduct);
    }
}

// ===== 選購商品：完全沒出現過、目錄裡沒有的商品，直接在這裡新增 =====
// 存進 pos_items（跟「修改 POS 商品」同一張表），不是只在這張訂單用一次的臨時快照——
// 這樣之後其他訂單也能直接選到、不用每次都重打，跟其他商品完全一視同仁。

const newProductToggle = document.getElementById('new-product-toggle');
const newProductPanel  = document.getElementById('new-product-panel');

function renderNewProductCategoryDatalist() {
    const dl = document.getElementById('np-category-datalist');
    if (!dl) return;
    const categories = [...new Set(products.map(p => (p.category_name_zh || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    dl.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

newProductToggle.addEventListener('click', () => {
    const opening = newProductPanel.classList.contains('hidden');
    newProductPanel.classList.toggle('hidden');
    if (!opening) return;

    renderNewProductCategoryDatalist();
    document.getElementById('np-error').classList.add('hidden');
    document.getElementById('np-name').value = '';
    document.getElementById('np-erp').value = '';
    // 目前如果正在瀏覽某個分類，新增商品預設帶入那個分類，省得再打一次。
    document.getElementById('np-category').value = (browseMode !== 'categories' && browseCategory)
        ? (categoryNameById[browseCategory] || browseCategory)
        : '';
});

document.getElementById('np-save-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('np-error');
    errorEl.classList.add('hidden');

    const name = document.getElementById('np-name').value.trim();
    if (!name) { alert('請輸入商品名稱'); return; }

    const category = document.getElementById('np-category').value.trim();
    // 沒填 ERP 編號的話自動生成一個（帶時間戳記，避免跟其他商品衝突），至少能先存進去，
    // 之後想改成正式編號再去「修改 POS 商品」改就好。
    const erp = document.getElementById('np-erp').value.trim() || `TEMP-${Date.now()}`;

    const payload = {
        erp_code: erp,
        category_name_zh: category || null,
        name_zh: name,
        is_active: true,
        row_index: 0,
        // 標記這筆是從 POS 下單這裡新增的，讓「修改 POS 商品」那邊可以顯示出來、
        // 提醒之後要把正式的 ERP 編號、圖片、價格等資料補齊。
        added_from_pos: true,
    };
    const { data, error } = await sb.from('pos_items').insert(payload).select().single();
    if (error) {
        // (erp_code, category_name_zh) 這組合已經存在的話會撞到 unique constraint。
        errorEl.textContent = error.code === '23505'
            ? '新增失敗：這個 ERP 編號在這個分類下已經有商品了，換一個編號或分類。'
            : '新增失敗：' + error.message;
        errorEl.classList.remove('hidden');
        return;
    }

    products.push(data);
    newProductPanel.classList.add('hidden');

    // 新增完直接進去這個商品的選規格畫面，跟平常點商品卡片是一樣的流程——新商品通常還沒有
    // 規格資料，這裡的軸清單會是空的，直接看得到數量/單位可以填、加入購物車。
    browseProduct = data;
    browseMode = 'variant';
    renderBrowseArea();
});

// 目前畫面上選到的值（按鈕優先，沒按按鈕才看有沒有打字），key 是軸名稱。
function currentVariantValues() {
    const values = {};
    Object.keys(selectedVariant).forEach(axis => {
        if (selectedVariant[axis]) values[axis] = selectedVariant[axis];
    });
    document.querySelectorAll('.variant-text-input').forEach(inp => {
        const axis = inp.dataset.axis;
        if (!values[axis] && inp.value.trim()) values[axis] = inp.value.trim();
    });
    return values;
}

// 跟 currentVariantValues 一樣，但不含系統自動幫忙選的軸——判斷「別的軸還能不能選」
// 只看使用者自己真的選過／打過的值，不能被自動帶出來的值反過來鎖住。
function manualVariantValues() {
    const values = currentVariantValues();
    autoSelectedAxes.forEach(axis => { delete values[axis]; });
    return values;
}

// 使用者自己動手選／打了某個軸之後（呼叫前要先把那個軸從 autoSelectedAxes 移除），
// 把「其他軸之前自動帶出來的值」全部清掉，讓 updateDisabledTiles 用最新的手動選擇
// 重新判斷一次——不然換了型號之後，舊型號自動帶出來的規格／顏色會卡著不放
// （即使剛好對新型號來說也還算有效），而不是重新根據現在真正選的型號判斷。
// 還是唯一選項的話會馬上被重新帶出來，不是唯一的話就維持沒有選，讓使用者自己選。
function clearAutoSelectedAxes() {
    autoSelectedAxes.forEach(axis => { selectedVariant[axis] = ''; });
    autoSelectedAxes.clear();
}

// 找出「目前選到的每個軸都對得上」的完整組合裡，比對到的軸最多（最具體）的那一筆；
// 這樣即使組合裡還帶著使用者沒有直接選的其他軸（例如型號帶出來的 W/H/L），也能找到。
function findBestCombo(erp, selectedValues) {
    const combos = combosByErp[erp] || [];
    const selectedEntries = Object.entries(selectedValues);
    if (!selectedEntries.length) return null;

    let best = null;
    let bestScore = 0;
    combos.forEach(combo => {
        const matches = selectedEntries.every(([k, v]) => combo.values[k] === v);
        if (!matches) return;
        const score = Object.keys(combo.values).length;
        if (score > bestScore) { best = combo; bestScore = score; }
    });
    return best;
}

// 有符合的完整組合、且它有實際照片就優先用那張；只選了一個軸的話，
// 退回用那個選項自己的照片（每個軸的選項本身也各自能上傳照片）；都沒有才用商品的一般照片。
function currentComboImage(p) {
    const values = currentVariantValues();
    const combo = findBestCombo(p.erp_code, values);
    if (combo && combo.image_url) return combo.image_url;

    const entries = Object.entries(values);
    if (entries.length === 1) {
        const [axis, value] = entries[0];
        const options = (variantOptionsByErp[p.erp_code] && variantOptionsByErp[p.erp_code][axis]) || [];
        const match = options.find(o => o.value === value);
        if (match && match.image_url) return match.image_url;
    }

    return thumbOf(p);
}


// 這個軸有沒有人「維護」過完整組合表格：找出所有包含這個軸的組合列裡，軸數最多的那一種組合形狀
// （例如商品有 規格/顏色/尺寸 三軸組合，就會回傳 ['規格','顏色','尺寸']）。
// 完全沒有任何組合提到這個軸的話回傳 null，代表這個軸還沒被拿來做過組合表格，維持預設全部可選。
function fullyTrackedAxisSet(erp, axis) {
    const combos = combosByErp[erp] || [];
    let best = null;
    combos.forEach(c => {
        const keys = Object.keys(c.values);
        if (!keys.includes(axis)) return;
        if (!best || keys.length > best.length) best = keys;
    });
    return best;
}

function isValueDisabled(erp, axis, value, otherSelectedValues) {
    const combos = combosByErp[erp] || [];

    // 1) 有沒有一筆「明確標記停用」的組合，剛好卡住這個值（組合裡其他軸都已經選定且對得上）。
    const explicitlyDisabled = combos.some(combo => {
        if (!combo.is_disabled) return false;
        if (combo.values[axis] !== value) return false;
        return Object.entries(combo.values).every(([k, v]) => k === axis || otherSelectedValues[k] === v);
    });
    if (explicitlyDisabled) return true;

    // 2) 這個軸有沒有被拿去建過完整組合表格（例如 規格/顏色/尺寸 三軸都建過組合），
    //    而且裡面「至少有一筆沒被停用、確定有效」的組合可以參考（只有停用標記、沒有任何
    //    確定有效的組合時不套用這條，避免把「大部分都可以選、只停用少數幾個」的商品也
    //    一起誤判成「沒建過的都不能選」）。
    //    有確定有效的組合可以參考的話，代表這個商品的組合資料是「有建立才算存在」——
    //    目前選到的這個值（含這次判斷的候選值），只要在同樣軸數、確定有效的組合裡，
    //    找不到任何一筆能對上已經選定的軸，就代表不管還沒選的軸怎麼選都湊不出真實存在的
    //    商品，直接視為不能選（不用另外標記停用）。
    const trackedAxes = fullyTrackedAxisSet(erp, axis);
    if (!trackedAxes) return false;

    const sameShapeCombos = combos.filter(c => {
        const keys = Object.keys(c.values);
        return keys.length === trackedAxes.length && trackedAxes.every(a => keys.includes(a));
    });
    const enabledSameShapeCombos = sameShapeCombos.filter(c => !c.is_disabled);
    if (!enabledSameShapeCombos.length) return false;

    const pinned = { ...otherSelectedValues, [axis]: value };
    const pinnedKeys = trackedAxes.filter(a => a in pinned);
    const anyMatch = enabledSameShapeCombos.some(c => pinnedKeys.every(a => c.values[a] === pinned[a]));
    return !anyMatch;
}

// 依照目前選到的值，把每個規格按鈕該不該變灰色（不能點）算出來；
// 如果目前選到的值剛好因為別的軸也選了而變成不能選的組合，自動取消選取，避免送出無效組合。
// 另外，還沒選的軸如果因為別的軸已經選了，只剩下唯一一個可以選的值
// （例如型號決定了唯一一組規格＋長度），直接幫忙選起來，不用使用者自己點。
function updateDisabledTiles(p) {
    const axisNames = productAxisNames(p);
    let changed = true;
    while (changed) {
        changed = false;
        const manual = manualVariantValues();

        // 自動選起來的值，只要是使用者自己選的其他軸（manual）判斷已經不成立了，就清掉
        // （不管它本來是使用者自己點的還是系統自動帶的），讓下面重新用最新的狀態補回來。
        Object.keys(selectedVariant).forEach(axis => {
            const value = selectedVariant[axis];
            if (!value) return;
            const others = { ...manual };
            delete others[axis];
            if (isValueDisabled(p.erp_code, axis, value, others)) {
                selectedVariant[axis] = '';
                autoSelectedAxes.delete(axis);
                changed = true;
            }
        });

        const manualAfterClear = manualVariantValues();
        axisNames.forEach(axis => {
            if (selectedVariant[axis]) return;
            const options = (variantOptionsByErp[p.erp_code] && variantOptionsByErp[p.erp_code][axis]) || [];
            const others = { ...manualAfterClear };
            const enabledValues = options.filter(o => !isValueDisabled(p.erp_code, axis, o.value, others));
            if (enabledValues.length === 1) {
                selectedVariant[axis] = enabledValues[0].value;
                autoSelectedAxes.add(axis);
                changed = true;
            }
        });
    }

    document.querySelectorAll('.variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === selectedVariant[b.dataset.axis]);
    });

    // 灰色（不能選）的判斷一樣只看使用者自己選的軸，不然自動帶出來的值會反過來
    // 把驅動它的那個軸（例如型號）自己的其他選項也鎖住，換不了型號。
    const manual = manualVariantValues();
    document.querySelectorAll('.variant-tile').forEach(btn => {
        const axis = btn.dataset.axis;
        const value = btn.dataset.value;
        const others = { ...manual };
        delete others[axis];
        btn.disabled = isValueDisabled(p.erp_code, axis, value, others);
    });
}

function updateVariantPreviewImage(p) {
    updateDisabledTiles(p);
    const img = document.getElementById('variant-preview-img');
    if (img) img.src = currentComboImage(p);
    refreshUnitRatioHint(); // 選到的規格/尺寸可能有自己專屬的單位比例，換選項就要重算提示文字
}

// 訂單存檔後，把這次用到、但還沒被登記過的值自動存成新的可點選項目
// （沒有圖片，之後可以去「修改 POS 商品」補上圖片）。已經是既有選項的值不會重複新增。
// 只看使用者「直接選」的軸（selected_axis_values），不看組合帶出來的其他軸
// （否則型號帶出來的 W/H/L 也會被學成獨立按鈕，變成不是原本要的資訊列了）。
async function learnNewVariantOptions(learnPayload) {
    const newRows = [];

    learnPayload.forEach(item => {
        const erp = item.product_erp_code;
        if (!erp) return;
        Object.entries(item.selected_axis_values || {}).forEach(([name, value]) => {
            const v = String(value || '').trim();
            if (!v) return;

            const known = (variantOptionsByErp[erp] && variantOptionsByErp[erp][name]) || [];
            if (known.some(o => o.value === v)) return;
            if (newRows.some(r => r.erp_code === erp && Object.keys(r.axis_values)[0] === name && r.axis_values[name] === v)) return;

            newRows.push({ erp_code: erp, axis_values: { [name]: v } });
        });
    });

    if (!newRows.length) return;

    const { error } = await sb.from('pos_item_variants').insert(newRows);
    if (error) {
        console.error('自動學習規格選項失敗：', error);
        return;
    }

    newRows.forEach(row => {
        const [name, value] = Object.entries(row.axis_values)[0];
        if (!variantOptionsByErp[row.erp_code]) variantOptionsByErp[row.erp_code] = {};
        if (!variantOptionsByErp[row.erp_code][name]) variantOptionsByErp[row.erp_code][name] = [];
        variantOptionsByErp[row.erp_code][name].push({ value, image_url: '' });
    });
}

// 保險機制：如果打了新單位但忘記按「新增」就直接加入購物車出單，訂單存檔後還是把它學起來，
// 下次就有按鈕可以點（正常走「新增」按鈕的話這裡不會找到新東西，因為已經存過了）。
// 同時也把「這個商品＋這個單位」的組合記到該商品身上，之後這個商品就會優先顯示自己的單位。
async function learnNewUnits(itemsPayload) {
    const newGlobalUnits = [...new Set(
        itemsPayload.map(item => String(item.unit || '').trim()).filter(v => v && !allUnits.includes(v))
    )];
    if (newGlobalUnits.length) {
        const rows = newGlobalUnits.map((name, i) => ({ name, sort_order: allUnits.length + i }));
        const { error } = await sb.from('pos_units').insert(rows);
        if (error) console.error('自動學習單位失敗：', error);
        else allUnits.push(...newGlobalUnits);
    }

    const newItemUnitRows = [];
    itemsPayload.forEach(item => {
        const erp = item.product_erp_code;
        const unit = String(item.unit || '').trim();
        if (!erp || !unit) return;
        const known = unitsByErp[erp] || [];
        if (known.some(u => u.name === unit)) return;
        if (newItemUnitRows.some(r => r.erp_code === erp && r.name === unit)) return;
        newItemUnitRows.push({ erp_code: erp, name: unit, sort_order: known.length });
    });
    if (newItemUnitRows.length) {
        const { error } = await sb.from('pos_item_units').insert(newItemUnitRows);
        if (error) { console.error('自動學習商品單位失敗：', error); return; }
        newItemUnitRows.forEach(row => {
            if (!unitsByErp[row.erp_code]) unitsByErp[row.erp_code] = [];
            unitsByErp[row.erp_code].push({ name: row.name, ratio: 1 });
        });
    }
}

// 只有一個選項的軸，不用使用者特地點一下，直接預設選起來
// （例如某些商品的 W／H 尺寸固定只有一種，不算是真的要選）。
function applyDefaultVariantSelections(p) {
    productAxisNames(p).forEach(axis => {
        const options = (variantOptionsByErp[p.erp_code] && variantOptionsByErp[p.erp_code][axis]) || [];
        if (options.length === 1) selectedVariant[axis] = options[0].value;
    });
    document.querySelectorAll('.variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === selectedVariant[b.dataset.axis]);
    });
}

function resetVariantPicker(p) {
    selectedVariant = {};
    autoSelectedAxes = new Set();
    document.querySelectorAll('.variant-tile.selected').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.variant-text-input').forEach(t => { t.value = ''; });
    if (p) applyDefaultVariantSelections(p);
    const qtyEl = document.getElementById('variant-qty');
    if (qtyEl) qtyEl.value = 1;

    selectedUnit = '';
    unitAddMode = false;
    renderUnitTiles();
}

// 單位按鈕排在同一列，最後面接一個「輸入新單位＋」按鈕；按下去才變成一個小輸入框，
// 打完按 Enter 或點掉就送出、變回按鈕（新單位也會馬上存進 pos_units，之後就有按鈕可以點）。
let unitAddMode = false;

// 商品自己有設定過單位就只顯示那些（有比例資料）；還沒設定過的話，退回顯示所有出現過的單位名稱
// （pos_units 是全店共用的參考清單，沒有針對這項商品的比例資料，所以 ratio 給 null）。
function currentUnitOptions() {
    if (!browseProduct) return [];
    const productUnits = unitsByErp[browseProduct.erp_code];
    if (productUnits && productUnits.length) return productUnits;
    return allUnits.map(name => ({ name, ratio: null }));
}

// 目前選到的軸剛好對到一筆完整組合、而且那筆組合對這個單位設定了專屬比例的話就用那個
// （找最具體、比對到的軸最多的那一筆，跟找組合照片用的邏輯一樣），找不到才退回商品層級
// （pos_item_units）的預設比例。
function effectiveUnitRatio(unitName, productRatio) {
    if (!browseProduct) return productRatio;
    const combo = findBestCombo(browseProduct.erp_code, currentVariantValues());
    const override = combo && combo.unit_ratios && combo.unit_ratios[unitName];
    return Number.isFinite(override) ? override : productRatio;
}

// 商品有 2 個以上「有比例資料」的單位時，才知道換算關係，顯示成一行灰字提示
// （例如 1個＝1個，1箱＝12個），比例基準用數值最小的那個單位當「1」。
function unitRatioHintText() {
    const options = currentUnitOptions().filter(u => Number.isFinite(u.ratio));
    if (options.length < 2) return '';
    const effective = options.map(u => ({ name: u.name, ratio: effectiveUnitRatio(u.name, u.ratio) }));
    const base = effective.reduce((min, u) => (u.ratio < min.ratio ? u : min), effective[0]);
    return effective.map(u => `1${u.name}＝${formatRatioNumber(u.ratio / base.ratio)}${base.name}`).join('，');
}

function refreshUnitRatioHint() {
    const hintEl = document.getElementById('unit-ratio-hint');
    if (hintEl) hintEl.textContent = unitRatioHintText();
}

function renderUnitTiles() {
    const container = document.getElementById('unit-tiles');
    if (!container) return;

    const unitBtnsHtml = currentUnitOptions().map(u => `
        <button type="button" class="category-filter-btn unit-btn${selectedUnit === u.name ? ' active' : ''}" data-unit="${escapeHtml(u.name)}">
            ${escapeHtml(u.name)}
        </button>`).join('');

    const addHtml = unitAddMode
        ? `<input type="text" id="unit-new-input" class="field-input" style="width:4.5rem;" placeholder="新單位">`
        : `<button type="button" id="unit-add-toggle-btn" class="category-filter-btn">輸入新單位＋</button>`;

    container.innerHTML = unitBtnsHtml + addHtml;

    container.querySelectorAll('.unit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedUnit = (selectedUnit === btn.dataset.unit) ? '' : btn.dataset.unit; // 再點一次取消選取
            renderUnitTiles();
        });
    });

    if (unitAddMode) {
        const input = document.getElementById('unit-new-input');
        input.focus();
        input.addEventListener('blur', () => commitNewUnit(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { unitAddMode = false; renderUnitTiles(); }
        });
    } else {
        document.getElementById('unit-add-toggle-btn').addEventListener('click', () => {
            unitAddMode = true;
            renderUnitTiles();
        });
    }

    refreshUnitRatioHint();
}

async function commitNewUnit(rawValue) {
    const value = rawValue.trim();
    unitAddMode = false;
    if (!value) { renderUnitTiles(); return; }

    if (!allUnits.includes(value)) {
        const { error } = await sb.from('pos_units').insert({ name: value, sort_order: allUnits.length });
        if (error) { alert('新增單位失敗：' + error.message); renderUnitTiles(); return; }
        allUnits.push(value);
    }

    // 順便記到這個商品身上，之後這個商品就會優先顯示自己的單位清單。
    if (browseProduct) {
        const erp = browseProduct.erp_code;
        const known = unitsByErp[erp] || [];
        if (!known.some(u => u.name === value)) {
            const { error } = await sb.from('pos_item_units').insert({ erp_code: erp, name: value, sort_order: known.length });
            if (!error) {
                if (!unitsByErp[erp]) unitsByErp[erp] = [];
                unitsByErp[erp].push({ name: value, ratio: 1 });
            }
        }
    }

    selectedUnit = value;
    renderUnitTiles();
}

// 軸選項的按鈕／打字輸入框的點擊/輸入事件，抽成獨立函式：初次畫規格畫面時要接一次，
// 「新增規格軸」之後只重畫軸欄位那一小塊時也要重新接一次（DOM 節點換新的了，舊的事件
// 監聽器沒有跟著過去）。
function wireVariantFieldInteractions(p) {
    document.querySelectorAll('.variant-text-input').forEach(textEl => {
        const axis = textEl.dataset.axis;
        textEl.addEventListener('input', () => {
            // 打字的話以打字為準，把按鈕選取取消，避免兩邊同時生效搞不清楚是哪個。
            autoSelectedAxes.delete(axis); // 使用者自己打字了，這個軸就不是自動帶的了
            clearAutoSelectedAxes(); // 其他軸之前自動帶的值也一併清掉，用最新的手動選擇重新判斷
            if (textEl.value.trim() && selectedVariant[axis]) {
                selectedVariant[axis] = '';
                document.querySelectorAll('.variant-tile').forEach(b => {
                    if (b.dataset.axis === axis) b.classList.remove('selected');
                });
            }
            updateVariantPreviewImage(p);
        });
    });

    document.querySelectorAll('.variant-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            const axis = btn.dataset.axis;
            const value = btn.dataset.value;
            selectedVariant[axis] = (selectedVariant[axis] === value) ? '' : value; // 再點一次取消選取
            autoSelectedAxes.delete(axis); // 使用者自己點了，這個軸就不是自動帶的了
            clearAutoSelectedAxes(); // 其他軸之前自動帶的值也一併清掉，用最新的手動選擇重新判斷
            document.querySelectorAll('.variant-tile').forEach(b => {
                if (b.dataset.axis === axis) b.classList.toggle('selected', b.dataset.value === selectedVariant[axis]);
            });
            // 點按鈕的話清掉打字框，避免畫面上同時顯示兩個不同的值。
            document.querySelectorAll('.variant-text-input').forEach(t => {
                if (t.dataset.axis === axis) t.value = '';
            });
            updateVariantPreviewImage(p);
        });
    });
}

// 「新增規格軸」存檔成功後用這個，只重畫軸欄位那一小塊，不要整個規格畫面重新來一次——
// 不然 wireVariantPicker 的初始化邏輯會把 selectedVariant 清空，使用者已經選好的其他軸
// 的值就不見了。重畫完把目前選到的值重新套用回新按鈕上（DOM 節點是全新的，選取樣式沒了）。
function refreshVariantFieldsOnly(p) {
    document.getElementById('variant-fields-wrap').innerHTML = renderVariantFieldsHtml(p);
    wireVariantFieldInteractions(p);
    document.querySelectorAll('.variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === selectedVariant[b.dataset.axis]);
    });
    updateVariantPreviewImage(p);
}

function wireVariantPicker(p) {
    const nameEditBtn = document.getElementById('variant-name-edit-btn');
    if (nameEditBtn) nameEditBtn.addEventListener('click', () => editProductOrderDisplayName(p));

    selectedVariant = {};
    autoSelectedAxes = new Set();
    selectedUnit = '';
    unitAddMode = false;
    renderUnitTiles();
    applyDefaultVariantSelections(p);

    wireVariantFieldInteractions(p);

    updateVariantPreviewImage(p);

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        const qty = Number(document.getElementById('variant-qty').value) || 1;
        const unitNewInput = document.getElementById('unit-new-input');
        const unit = selectedUnit || (unitNewInput ? unitNewInput.value.trim() : '');

        // 訂單快照要記錄完整的一組值：使用者直接選的軸，加上符合的完整組合帶出來的其他軸
        // （例如選了型號，組合裡的 W/H/L 也要一起記進這張訂單，出貨單才看得到）。
        const selected = currentVariantValues();
        const combo = findBestCombo(p.erp_code, selected);
        const variantValues = combo ? { ...selected, ...combo.values } : selected;

        cart.push({
            rowId: ++cartCounter,
            erp: p.erp_code,
            name_zh: orderDisplayName(p),
            image_url: currentComboImage(p),
            variant_values: variantValues,
            selected_axis_values: selected, // 只用來之後「自動學習新選項」，不會存進訂單
            unit,
            qty,
        });
        renderCart();

        // 加入後留在同一個商品的規格畫面，方便同一項商品連續加不同規格；
        // 要換商品的話可以按上面的「← 返回」或「主分類」。
        resetVariantPicker(p);
        updateVariantPreviewImage(p);
    });

    const newAxisToggle = document.getElementById('new-axis-toggle');
    const newAxisPanel = document.getElementById('new-axis-panel');
    newAxisToggle.addEventListener('click', () => {
        newAxisPanel.classList.toggle('hidden');
        if (!newAxisPanel.classList.contains('hidden')) document.getElementById('na-name-input').focus();
    });

    document.getElementById('na-add-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('na-name-input');
        const valueInput = document.getElementById('na-value-input');
        const statusEl = document.getElementById('na-status');
        const axisName = nameInput.value.trim();
        if (!axisName) { nameInput.focus(); return; }
        const values = splitBulkValues(valueInput.value);
        if (!values.length) { valueInput.focus(); return; }

        const existing = new Set(((variantOptionsByErp[p.erp_code] || {})[axisName] || []).map(o => o.value));
        const newValues = values.filter(v => !existing.has(v));
        if (!newValues.length) { valueInput.value = ''; return; }

        statusEl.textContent = '新增中…';
        const rows = newValues.map(v => ({ erp_code: p.erp_code, axis_values: { [axisName]: v }, sort_order: 0 }));
        const { error } = await sb.from('pos_item_variants').insert(rows);
        if (error) {
            statusEl.textContent = '';
            alert('新增規格軸失敗：' + error.message);
            return;
        }

        // 新增成功，直接更新本地資料重畫一次，不用整頁重新整理——馬上就能在上面看到、選用這個軸。
        if (!variantOptionsByErp[p.erp_code]) variantOptionsByErp[p.erp_code] = {};
        if (!variantOptionsByErp[p.erp_code][axisName]) variantOptionsByErp[p.erp_code][axisName] = [];
        newValues.forEach(v => variantOptionsByErp[p.erp_code][axisName].push({ value: v, image_url: '' }));

        statusEl.textContent = `已新增「${axisName}」的 ${newValues.length} 個選項。`;
        nameInput.value = '';
        valueInput.value = '';
        refreshVariantFieldsOnly(p);
    });
}

// ===== 已選購商品（購物車） =====

function renderCart() {
    if (!cart.length) {
        cartContainer.innerHTML = `<p class="text-gray-400 text-sm">尚未加入商品</p>`;
        return;
    }
    cartContainer.innerHTML = cart.map(item => {
        const variant = formatVariantSummary(item);
        return `
            <div class="flex items-center gap-3 bg-white border rounded-lg p-3 mb-2">
                <img src="${escapeHtml(item.image_url)}" alt="" class="product-thumb" style="width:48px;height:48px;flex-shrink:0;">
                <div class="flex-1 min-w-0">
                    <p class="cart-item-name">${escapeHtml(item.name_zh || item.erp || '')}</p>
                    <p class="cart-item-meta">${variant ? escapeHtml(variant) + '　' : ''}數量：${item.qty}${item.unit ? escapeHtml(item.unit) : ''}</p>
                </div>
                <button type="button" data-row-id="${item.rowId}" class="cart-del-btn text-red-400 hover:text-red-600 text-sm shrink-0">刪除</button>
            </div>`;
    }).join('');

    cartContainer.querySelectorAll('.cart-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            cart = cart.filter(item => item.rowId !== Number(btn.dataset.rowId));
            renderCart();
        });
    });
}

// ===== 儲存訂單 =====

// 訂單日期用瀏覽器內建的月曆選（<input type="date">），值本身就是西元 'YYYY-MM-DD'，
// 旁邊另外顯示一個民國年的文字標籤方便對照（訂單、出貨單其他地方都是看民國年）。
// 瀏覽器內建的日期選擇器沒辦法顯示民國年，所以訂單日期改成自己畫一個小月曆：
// 選到的日期存在隱藏欄位 #order-date-input（西元 'YYYY-MM-DD'，給存檔邏輯讀），
// 畫面上顯示的按鈕文字跟月曆本身都是民國年格式（YYY/MM/DD）。
let orderDateCalendarViewDate = new Date(); // 月曆目前顯示到哪個月份（只看年、月）

function isoDateOf(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function setOrderDate(isoDate) {
    document.getElementById('order-date-input').value = isoDate;
    document.getElementById('order-date-display-btn').textContent = isoDateToRocLabel(isoDate);
}

function renderOrderDateCalendar() {
    const container = document.getElementById('order-date-calendar');
    const viewYear = orderDateCalendarViewDate.getFullYear();
    const viewMonth = orderDateCalendarViewDate.getMonth(); // 0-based
    const selectedIso = document.getElementById('order-date-input').value;

    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0＝星期日
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

    let cellsHtml = '';
    for (let i = 0; i < firstWeekday; i++) cellsHtml += '<div></div>';
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = isoDateOf(viewYear, viewMonth, day);
        const isSelected = iso === selectedIso;
        cellsHtml += `<button type="button" class="order-date-day-btn text-center text-sm py-1 rounded ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}" data-iso="${iso}">${day}</button>`;
    }

    container.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <button type="button" id="order-date-prev-month" class="px-2 py-1 text-sm rounded hover:bg-gray-100">‹</button>
            <span class="text-sm font-bold">民國${viewYear - 1911}年${String(viewMonth + 1).padStart(2, '0')}月</span>
            <button type="button" id="order-date-next-month" class="px-2 py-1 text-sm rounded hover:bg-gray-100">›</button>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
            ${weekdayLabels.map(w => `<div>${w}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-1">${cellsHtml}</div>
        <div class="text-right mt-2">
            <button type="button" id="order-date-today-btn" class="text-xs text-blue-600 hover:underline">回到今天</button>
        </div>`;

    document.getElementById('order-date-prev-month').addEventListener('click', () => {
        orderDateCalendarViewDate = new Date(viewYear, viewMonth - 1, 1);
        renderOrderDateCalendar();
    });
    document.getElementById('order-date-next-month').addEventListener('click', () => {
        orderDateCalendarViewDate = new Date(viewYear, viewMonth + 1, 1);
        renderOrderDateCalendar();
    });
    document.getElementById('order-date-today-btn').addEventListener('click', () => {
        const today = new Date();
        orderDateCalendarViewDate = new Date(today.getFullYear(), today.getMonth(), 1);
        setOrderDate(isoDateOf(today.getFullYear(), today.getMonth(), today.getDate()));
        renderOrderDateCalendar();
    });
    container.querySelectorAll('.order-date-day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setOrderDate(btn.dataset.iso);
            container.classList.add('hidden');
        });
    });
}

function initOrderDateField() {
    const today = new Date();
    orderDateCalendarViewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    setOrderDate(isoDateOf(today.getFullYear(), today.getMonth(), today.getDate()));

    const displayBtn = document.getElementById('order-date-display-btn');
    const calendar = document.getElementById('order-date-calendar');

    displayBtn.addEventListener('click', () => {
        if (calendar.classList.contains('hidden')) {
            // 每次打開都跳回目前選到的日期所在月份，比較直覺。
            const iso = document.getElementById('order-date-input').value;
            if (iso) {
                const [y, m] = iso.split('-').map(Number);
                orderDateCalendarViewDate = new Date(y, m - 1, 1);
            }
            renderOrderDateCalendar();
            calendar.classList.remove('hidden');
        } else {
            calendar.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!calendar.contains(e.target) && e.target !== displayBtn) {
            calendar.classList.add('hidden');
        }
    });
}

// 訂單日期欄位選的是「哪一天」，時分秒還是用當下實際存檔的時間，
// 這樣同一天存好幾張訂單，排序還是看得出先後順序。
function orderCreatedAtFromDateFields() {
    const isoDate = document.getElementById('order-date-input').value;
    if (!isoDate) return null;
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    const now = new Date();
    const combined = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return combined.toISOString();
}

saveOrderBtn.addEventListener('click', async () => {
    resultBanner.classList.add('hidden');

    const customerId = selectedCustomerId;
    if (!customerId) { alert('請先選擇客戶'); return; }
    if (!cart.length) { alert('請至少加入一項商品'); return; }

    const createdAt = orderCreatedAtFromDateFields();
    if (!createdAt) { alert('請選擇訂單日期'); return; }

    saveOrderBtn.disabled = true;
    saveOrderBtn.textContent = '儲存中…';

    const pickupTag = currentPickupTag();

    try {
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .insert({ customer_id: customerId, created_by_email: currentUserEmail, created_by_name: currentUserDisplayName, created_at: createdAt, pickup_tag: pickupTag || null })
            .select()
            .single();
        if (orderErr) throw orderErr;

        const itemsPayload = cart.map(item => ({
            order_id: order.id,
            product_erp_code: item.erp,
            product_name_zh: item.name_zh,
            product_image_url: item.image_url,
            variant_values: item.variant_values || {},
            unit: item.unit,
            quantity: item.qty,
        }));
        const learnPayload = cart.map(item => ({
            product_erp_code: item.erp,
            selected_axis_values: item.selected_axis_values || {},
        }));
        const { error: itemsErr } = await sb.from('order_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        await learnNewUnits(itemsPayload);
        await learnNewPickupTag(pickupTag);

        // 訂單已經真的存進資料庫了，此時清空購物車，離開頁面的提醒才不會誤判成「還有未儲存的東西」。
        cart = [];
        renderCart();

        const customer = customers.find(c => String(c.id) === String(customerId));

        // 出單後清空客戶，方便接著幫同一區域的下一位客戶下單；區域篩選（selectedRegionFilter）不受影響。
        deselectCustomer();
        resetPickupTag(); // 取貨方式是每張訂單各自的，出單後清掉，不要沿用到下一張訂單

        await learnNewVariantOptions(learnPayload);
        resultBanner.classList.remove('hidden');
        resultBanner.innerHTML = `
            ✅ 訂單已儲存，訂單編號：<strong>${escapeHtml(order.order_no)}</strong>
            <button id="download-pdf-btn" class="ml-3 px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700">下載出貨單 PDF</button>
            <button id="new-order-btn" class="ml-2 px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100">建立下一張訂單</button>
        `;
        document.getElementById('download-pdf-btn').addEventListener('click', () => {
            generateOrderPdf(order, customer, itemsPayload);
        });
        document.getElementById('new-order-btn').addEventListener('click', () => {
            resultBanner.classList.add('hidden');
            browseMode = 'categories';
            searchInput.value = '';
            renderBrowseArea();
            deselectCustomer();
        });
    } catch (e) {
        alert('儲存失敗：' + e.message);
    } finally {
        saveOrderBtn.disabled = false;
        saveOrderBtn.textContent = '儲存訂單並出單';
    }
});

// 快捷鍵：Shift+Enter＝按一下「儲存訂單並出單」（頁面上沒有多行輸入框，不會跟打字衝突）。
document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'Enter' && !saveOrderBtn.disabled) {
        e.preventDefault();
        saveOrderBtn.click();
    }
});

initScrollRestoration('pos');
initAdminAuth('pos', initPos);
