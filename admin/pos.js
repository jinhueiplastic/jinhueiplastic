let products = []; // 其實是 Supabase 的 pos_items 表資料，變數名稱沿用舊的
let customers = [];
let cart = [];
let cartCounter = 0;
let categoryCards = [];      // 官網「商品目錄」頁用的分類卡片：{ catId, name, image }
let categoryNameById = {};   // catId -> 中文分類顯示名稱
let variantOptionsByErp = {}; // erp_code -> { 軸名稱: [{value,image_url}], ... }，各軸各自有哪些可點選項目
let selectedVariant = {}; // 目前規格畫面上，用按鈕/打字選到的值，key 是軸名稱
let combosByErp = {}; // erp_code -> [{ values: {軸名:值,...}, image_url }]，同一列記錄好幾個軸的完整組合
let allUnits = []; // 所有出現過的單位（來自 pos_units），商品自己沒設定過單位時的備援清單
let unitsByErp = {}; // erp_code -> [單位名稱]，每個商品各自記住自己常用的單位
let selectedUnit = ''; // 目前規格畫面上，用按鈕點選的單位
let selectedRegionFilter = new URLSearchParams(location.search).get('region') || null; // 依區域篩選客戶，null＝全部

// 瀏覽狀態：categories（分類卡片）→ products（該分類/搜尋結果的商品卡片）→ variant（選規格數量）
let browseMode = 'categories';
let browseCategory = null; // 目前瀏覽的分類名稱；搜尋結果時為 null
let browseItems = [];      // products 模式下要顯示的商品清單
let browseProduct = null;  // variant 模式下選中的商品

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
    const [{ data: productData, error: pErr }, { data: customerData, error: cErr }, { data: catData, error: catErr }, { data: variantData, error: vErr }, { data: unitData, error: uErr }, { data: itemUnitData, error: iuErr }] = await Promise.all([
        sb.from('pos_items').select('*').order('category_name_zh', { ascending: true }),
        sb.from('customers').select('*').order('name', { ascending: true }),
        sb.from('site_content').select('*').eq('page', 'Product Catalog').order('row_index', { ascending: true }),
        sb.from('pos_item_variants').select('*').order('sort_order', { ascending: true }),
        sb.from('pos_units').select('*').order('sort_order', { ascending: true }),
        sb.from('pos_item_units').select('*').order('sort_order', { ascending: true }),
    ]);
    if (pErr) console.error(pErr);
    if (cErr) console.error(cErr);
    if (catErr) console.error(catErr);
    if (vErr) console.error(vErr);
    if (uErr) console.error(uErr);
    if (iuErr) console.error(iuErr);
    products = productData || [];
    customers = customerData || [];
    allUnits = (unitData || []).map(u => u.name);

    unitsByErp = {};
    (itemUnitData || []).forEach(u => {
        if (!unitsByErp[u.erp_code]) unitsByErp[u.erp_code] = [];
        unitsByErp[u.erp_code].push(u.name);
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
            combosByErp[v.erp_code].push({ values: v.axis_values, image_url: v.image_url });
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

// ===== 客戶搜尋（即時打字篩選，取代原本的下拉選單） =====
let selectedCustomerId = '';
const customerSearchInput   = document.getElementById('customer-search-input');
const customerSearchResults = document.getElementById('customer-search-results');

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
                <div class="font-medium">${escapeHtml(c.name)}</div>
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
    newCustomerPanel.classList.toggle('hidden');
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
    if (browseMode === 'variant') {
        browseMode = 'products';
    } else {
        browseMode = 'categories';
        searchInput.value = '';
    }
    renderBrowseArea();
});

homeBtn.addEventListener('click', () => {
    browseMode = 'categories';
    browseCategory = null;
    searchInput.value = '';
    renderBrowseArea();
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
function renderVariantPickerHtml(p) {
    const axisNames = productAxisNames(p);
    const fieldsHtml = axisNames.map(name => variantFieldHtml(name, p)).join('');
    return `
        <div class="flex gap-4 flex-col sm:flex-row">
            <img id="variant-preview-img" src="${escapeHtml(thumbOf(p))}" alt=""
                 style="width:140px;height:140px;object-fit:cover;flex-shrink:0;background:#f3f4f6;"
                 class="rounded-lg border">
            <div class="flex-1">
                <p class="text-xs text-blue-600 font-bold">${escapeHtml(p.erp_code || '')}</p>
                <h4 class="font-bold text-lg text-gray-800 mb-3">${escapeHtml(orderDisplayName(p))}</h4>
                <div class="space-y-3">
                    ${fieldsHtml}
                    <div id="variant-combo-info" class="text-xs text-gray-500"></div>
                    <div class="flex flex-wrap items-end gap-2">
                        <div>
                            <label class="field-label">數量</label>
                            <input type="number" id="variant-qty" class="field-input" style="width:4.5rem;" min="1" value="1">
                        </div>
                        <div id="unit-tiles" class="flex flex-wrap items-center gap-2"></div>
                    </div>
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

// 符合的完整組合如果還帶有使用者沒有直接選的其他軸（例如型號帶出來的 W/H/L），顯示成資訊列給參考。
function comboExtraInfoText(p) {
    const values = currentVariantValues();
    const combo = findBestCombo(p.erp_code, values);
    if (!combo) return '';
    const extra = Object.entries(combo.values).filter(([k]) => !(k in values));
    if (!extra.length) return '';
    return extra.map(([k, v]) => `${k}：${v}`).join('　');
}

function updateVariantPreviewImage(p) {
    const img = document.getElementById('variant-preview-img');
    if (img) img.src = currentComboImage(p);
    const infoEl = document.getElementById('variant-combo-info');
    if (infoEl) infoEl.textContent = comboExtraInfoText(p);
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
        if (known.includes(unit)) return;
        if (newItemUnitRows.some(r => r.erp_code === erp && r.name === unit)) return;
        newItemUnitRows.push({ erp_code: erp, name: unit, sort_order: known.length });
    });
    if (newItemUnitRows.length) {
        const { error } = await sb.from('pos_item_units').insert(newItemUnitRows);
        if (error) { console.error('自動學習商品單位失敗：', error); return; }
        newItemUnitRows.forEach(row => {
            if (!unitsByErp[row.erp_code]) unitsByErp[row.erp_code] = [];
            unitsByErp[row.erp_code].push(row.name);
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

// 商品自己有設定過單位就只顯示那些；還沒設定過的話，退回顯示所有出現過的單位，
// 不會讓還沒設定的商品完全沒有單位可選。
function currentUnitOptions() {
    if (!browseProduct) return allUnits;
    const productUnits = unitsByErp[browseProduct.erp_code];
    return (productUnits && productUnits.length) ? productUnits : allUnits;
}

function renderUnitTiles() {
    const container = document.getElementById('unit-tiles');
    if (!container) return;

    const unitBtnsHtml = currentUnitOptions().map(u => `
        <button type="button" class="category-filter-btn unit-btn${selectedUnit === u ? ' active' : ''}" data-unit="${escapeHtml(u)}">
            ${escapeHtml(u)}
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
        if (!known.includes(value)) {
            const { error } = await sb.from('pos_item_units').insert({ erp_code: erp, name: value, sort_order: known.length });
            if (!error) {
                if (!unitsByErp[erp]) unitsByErp[erp] = [];
                unitsByErp[erp].push(value);
            }
        }
    }

    selectedUnit = value;
    renderUnitTiles();
}

function wireVariantPicker(p) {
    selectedVariant = {};
    selectedUnit = '';
    unitAddMode = false;
    renderUnitTiles();
    applyDefaultVariantSelections(p);

    document.querySelectorAll('.variant-text-input').forEach(textEl => {
        const axis = textEl.dataset.axis;
        textEl.addEventListener('input', () => {
            // 打字的話以打字為準，把按鈕選取取消，避免兩邊同時生效搞不清楚是哪個。
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
function initOrderDateField() {
    const dateInput = document.getElementById('order-date-input');
    const rocLabel = document.getElementById('order-date-roc-label');
    dateInput.value = new Date().toISOString().slice(0, 10);
    rocLabel.textContent = isoDateToRocLabel(dateInput.value);
    dateInput.addEventListener('input', () => {
        rocLabel.textContent = isoDateToRocLabel(dateInput.value);
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

    try {
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .insert({ customer_id: customerId, created_by_email: currentUserEmail, created_by_name: currentUserDisplayName, created_at: createdAt })
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

        // 訂單已經真的存進資料庫了，此時清空購物車，離開頁面的提醒才不會誤判成「還有未儲存的東西」。
        cart = [];
        renderCart();

        const customer = customers.find(c => String(c.id) === String(customerId));

        // 出單後清空客戶，方便接著幫同一區域的下一位客戶下單；區域篩選（selectedRegionFilter）不受影響。
        deselectCustomer();

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

initAdminAuth('pos', initPos);
