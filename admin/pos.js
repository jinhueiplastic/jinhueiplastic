let products = []; // 其實是 Supabase 的 pos_items 表資料，變數名稱沿用舊的
let customers = [];
let cart = [];
let cartCounter = 0;
let categoryCards = [];      // 官網「商品目錄」頁用的分類卡片：{ catId, name, image }
let categoryNameById = {};   // catId -> 中文分類顯示名稱
let variantOptionsByErp = {}; // erp_code -> { spec: [{value,image_url}], bore: [...], color: [...] }
let selectedVariant = { spec: '', bore: '', color: '' }; // 目前規格畫面上，用按鈕點選的值
let comboImagesByErp = {}; // erp_code -> { 'spec||bore||color': image_url }，每個確切組合各自的商品照

// 瀏覽狀態：categories（分類卡片）→ products（該分類/搜尋結果的商品卡片）→ variant（選規格數量）
let browseMode = 'categories';
let browseCategory = null; // 目前瀏覽的分類名稱；搜尋結果時為 null
let browseItems = [];      // products 模式下要顯示的商品清單
let browseProduct = null;  // variant 模式下選中的商品

const customerSelect     = document.getElementById('customer-select');
const newCustomerToggle  = document.getElementById('new-customer-toggle');
const newCustomerPanel   = document.getElementById('new-customer-panel');
const customerInfo       = document.getElementById('customer-info');
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
    const [{ data: productData, error: pErr }, { data: customerData, error: cErr }, { data: catData, error: catErr }, { data: variantData, error: vErr }, { data: comboData, error: comboErr }] = await Promise.all([
        sb.from('pos_items').select('*').order('category_name_zh', { ascending: true }),
        sb.from('customers').select('*').order('name', { ascending: true }),
        sb.from('site_content').select('*').eq('page', 'Product Catalog').order('row_index', { ascending: true }),
        sb.from('pos_item_variants').select('*').order('sort_order', { ascending: true }),
        sb.from('pos_item_combo_images').select('*'),
    ]);
    if (pErr) console.error(pErr);
    if (cErr) console.error(cErr);
    if (catErr) console.error(catErr);
    if (vErr) console.error(vErr);
    if (comboErr) console.error(comboErr);
    products = productData || [];
    customers = customerData || [];

    variantOptionsByErp = {};
    (variantData || []).forEach(v => {
        if (!variantOptionsByErp[v.erp_code]) variantOptionsByErp[v.erp_code] = { spec: [], bore: [], color: [] };
        if (variantOptionsByErp[v.erp_code][v.variant_type]) {
            variantOptionsByErp[v.erp_code][v.variant_type].push(v);
        }
    });

    comboImagesByErp = {};
    (comboData || []).forEach(c => {
        if (!comboImagesByErp[c.erp_code]) comboImagesByErp[c.erp_code] = {};
        comboImagesByErp[c.erp_code][[c.spec || '', c.bore || '', c.color || ''].join('||')] = c.image_url;
    });

    // 跟官網「商品目錄」頁用同一份分類卡片資料（site_content，page = Product Catalog）：
    // row_key 含 categories 的列才是分類卡片，link 欄位是拿來比對 products.category_name_zh 的識別碼，
    // image 欄位是官網那邊已經放好的分類封面圖。
    categoryCards = (catData || [])
        .filter(r => String(r.row_key || '').toLowerCase().includes('categories') && r.chinese)
        .map(r => ({ catId: r.link || '', name: r.chinese || '', image: r.image || '' }));
    categoryNameById = {};
    categoryCards.forEach(c => { categoryNameById[c.catId] = c.name; });

    renderCustomerOptions();

    cart = [];
    browseMode = 'categories';
    browseCategory = null;
    renderBrowseArea();
    renderCart();
}

function renderCustomerOptions() {
    customerSelect.innerHTML = '<option value="">請選擇客戶…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

customerSelect.addEventListener('change', () => {
    const c = customers.find(x => String(x.id) === customerSelect.value);
    customerInfo.textContent = c ? `地址：${c.address || '（無）'}　電話：${c.phone || '（無）'}` : '';
});

newCustomerToggle.addEventListener('click', () => {
    newCustomerPanel.classList.toggle('hidden');
});

document.getElementById('nc-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('nc-name').value.trim();
    if (!name) { alert('請輸入客戶名稱'); return; }
    const payload = {
        name,
        address: document.getElementById('nc-address').value.trim(),
        phone: document.getElementById('nc-phone').value.trim(),
    };
    const { data, error } = await sb.from('customers').insert(payload).select().single();
    if (error) { alert('新增客戶失敗：' + error.message); return; }

    customers.push(data);
    customers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    renderCustomerOptions();
    customerSelect.value = data.id;
    customerSelect.dispatchEvent(new Event('change'));
    newCustomerPanel.classList.add('hidden');
    ['nc-name', 'nc-address', 'nc-phone'].forEach(id => { document.getElementById(id).value = ''; });
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

function productMatches(p, q) {
    const query = q.toLowerCase();
    return String(p.erp_code || '').toLowerCase().includes(query)
        || String(p.name_zh || '').toLowerCase().includes(query)
        || String(p.name_en || '').toLowerCase().includes(query);
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
                    <img src="${escapeHtml(thumbOf(p))}" alt="${escapeHtml(p.name_zh || '')}" style="background:#f3f4f6;">
                </div>
                <div class="p-3 text-center bg-white border-t">
                    <p class="text-xs text-blue-600 font-bold mb-0.5">${escapeHtml(p.erp_code || '')}</p>
                    <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(p.name_zh || '')}</h4>
                </div>
            </div>`).join('') +
        `</div>`;
}

const VARIANT_LABELS = { spec: '規格', bore: '孔徑', color: '顏色' };

// 有圖片式選項（pos_item_variants）就畫成可以直接點的按鈕；沒有的話退回打字＋建議清單。
function variantFieldHtml(type, product) {
    const options = (variantOptionsByErp[product.erp_code] && variantOptionsByErp[product.erp_code][type]) || [];
    const label = VARIANT_LABELS[type];

    if (options.length) {
        return `
            <div>
                <label class="field-label">${label}</label>
                <div class="flex flex-wrap gap-2">
                    ${options.map(o => `
                        <button type="button" class="variant-tile" data-type="${type}" data-value="${escapeHtml(o.value)}">
                            ${o.image_url ? `<img src="${escapeHtml(o.image_url)}" alt="${escapeHtml(o.value)}">` : ''}
                            <span>${escapeHtml(o.value)}</span>
                        </button>`).join('')}
                </div>
            </div>`;
    }

    return `
        <div>
            <label class="field-label">${label}</label>
            <input type="text" id="variant-${type}-text" class="field-input" list="variant-${type}-list" placeholder="如有可選，或自行輸入">
            <datalist id="variant-${type}-list"></datalist>
        </div>`;
}

function renderVariantPickerHtml(p) {
    return `
        <div class="flex gap-4 flex-col sm:flex-row">
            <img id="variant-preview-img" src="${escapeHtml(thumbOf(p))}" alt=""
                 style="width:140px;height:140px;object-fit:cover;flex-shrink:0;background:#f3f4f6;"
                 class="rounded-lg border">
            <div class="flex-1">
                <p class="text-xs text-blue-600 font-bold">${escapeHtml(p.erp_code || '')}</p>
                <h4 class="font-bold text-lg text-gray-800 mb-3">${escapeHtml(p.name_zh || '')}</h4>
                <div class="space-y-3">
                    ${variantFieldHtml('spec', p)}
                    ${variantFieldHtml('bore', p)}
                    ${variantFieldHtml('color', p)}
                    <div class="w-32">
                        <label class="field-label">數量</label>
                        <input type="number" id="variant-qty" class="field-input" min="1" value="1">
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
        breadcrumb.textContent = (browseCategory ? `分類：${categoryNameById[browseCategory] || browseCategory}　` : '') + `商品：${browseProduct.name_zh || browseProduct.erp_code}`;
        browseArea.innerHTML = renderVariantPickerHtml(browseProduct);
        wireVariantPicker(browseProduct);
    }
}

// 解析商品說明欄位裡「所有」的 markdown 表格（不只第一個），
// 依表格標題關鍵字分類成規格/孔徑/顏色的建議選項。
function parseAllTables(text) {
    const lines = String(text || '').split('\n');
    const tables = [];
    const cellsOf = line => line.trim().split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.includes('|')) {
            const start = i;
            let end = i;
            while (end + 1 < lines.length && lines[end + 1].trim().startsWith('|')) end++;
            const blockLines = lines.slice(start, end + 1);
            const headers = cellsOf(blockLines[0]);
            const dataLines = blockLines.slice(1).filter(l => !/^[|:\s-]+$/.test(l.trim()));
            tables.push({ headers, rows: dataLines.map(cellsOf) });
            i = end + 1;
        } else {
            i++;
        }
    }
    return tables;
}

function classifyOptions(text) {
    const result = { spec: [], bore: [], color: [] };
    parseAllTables(text).forEach(t => {
        const headerText = t.headers.join('');
        const values = [...new Set(t.rows.map(r => r[0]).filter(Boolean))];
        if (!values.length) return;
        if (/孔|徑/.test(headerText)) result.bore.push(...values);
        else if (/色/.test(headerText)) result.color.push(...values);
        else result.spec.push(...values);
    });
    return result;
}

function currentVariantValue(type) {
    if (selectedVariant[type]) return selectedVariant[type];
    const textEl = document.getElementById(`variant-${type}-text`);
    return textEl ? textEl.value.trim() : '';
}

// 有這個確切組合（規格+孔徑+顏色）的實際商品照片就用那張，沒有的話退回該商品的一般照片。
function findComboImage(erp, spec, bore, color) {
    const key = [spec || '', bore || '', color || ''].join('||');
    return (comboImagesByErp[erp] && comboImagesByErp[erp][key]) || '';
}

function currentComboImage(p) {
    return findComboImage(p.erp_code, currentVariantValue('spec'), currentVariantValue('bore'), currentVariantValue('color')) || thumbOf(p);
}

function updateVariantPreviewImage(p) {
    const img = document.getElementById('variant-preview-img');
    if (img) img.src = currentComboImage(p);
}

function resetVariantPicker() {
    selectedVariant = { spec: '', bore: '', color: '' };
    document.querySelectorAll('.variant-tile.selected').forEach(b => b.classList.remove('selected'));
    ['spec', 'bore', 'color'].forEach(type => {
        const textEl = document.getElementById(`variant-${type}-text`);
        if (textEl) textEl.value = '';
    });
    const qtyEl = document.getElementById('variant-qty');
    if (qtyEl) qtyEl.value = 1;
}

function wireVariantPicker(p) {
    selectedVariant = { spec: '', bore: '', color: '' };

    // 沒有圖片式選項的類型，退回打字＋建議清單（建議清單沿用 desc_zh 裡解析出來的表格）。
    const suggested = classifyOptions(p.desc_zh);
    ['spec', 'bore', 'color'].forEach(type => {
        const list = document.getElementById(`variant-${type}-list`);
        if (list) list.innerHTML = suggested[type].map(v => `<option value="${escapeHtml(v)}">`).join('');
        const textEl = document.getElementById(`variant-${type}-text`);
        if (textEl) textEl.addEventListener('input', () => updateVariantPreviewImage(p));
    });

    document.querySelectorAll('.variant-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const value = btn.dataset.value;
            selectedVariant[type] = (selectedVariant[type] === value) ? '' : value; // 再點一次取消選取
            document.querySelectorAll(`.variant-tile[data-type="${type}"]`).forEach(b => {
                b.classList.toggle('selected', b.dataset.value === selectedVariant[type]);
            });
            updateVariantPreviewImage(p);
        });
    });

    updateVariantPreviewImage(p);

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        const qty = Number(document.getElementById('variant-qty').value) || 1;
        cart.push({
            rowId: ++cartCounter,
            erp: p.erp_code,
            name_zh: p.name_zh,
            image_url: currentComboImage(p),
            spec: currentVariantValue('spec'),
            bore: currentVariantValue('bore'),
            color: currentVariantValue('color'),
            qty,
        });
        renderCart();

        // 加入後留在同一個商品的規格畫面，方便同一項商品連續加不同規格；
        // 要換商品的話可以按上面的「← 返回」或「主分類」。
        resetVariantPicker();
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
        const variant = [item.spec, item.bore, item.color].filter(Boolean).join(' / ');
        return `
            <div class="flex items-center gap-3 bg-white border rounded-lg p-3 mb-2">
                <img src="${escapeHtml(item.image_url)}" alt="" class="product-thumb" style="width:48px;height:48px;">
                <div class="flex-1">
                    <p class="font-bold text-sm">${escapeHtml(item.name_zh || item.erp || '')}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(item.erp || '')}${variant ? '　' + escapeHtml(variant) : ''}　數量：${item.qty}</p>
                </div>
                <button type="button" data-row-id="${item.rowId}" class="cart-del-btn text-red-400 hover:text-red-600 text-sm">刪除</button>
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

saveOrderBtn.addEventListener('click', async () => {
    resultBanner.classList.add('hidden');

    const customerId = customerSelect.value;
    if (!customerId) { alert('請先選擇客戶'); return; }
    if (!cart.length) { alert('請至少加入一項商品'); return; }

    saveOrderBtn.disabled = true;
    saveOrderBtn.textContent = '儲存中…';

    try {
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .insert({ customer_id: customerId })
            .select()
            .single();
        if (orderErr) throw orderErr;

        const itemsPayload = cart.map(item => ({
            order_id: order.id,
            product_erp_code: item.erp,
            product_name_zh: item.name_zh,
            product_image_url: item.image_url,
            spec: item.spec,
            bore: item.bore,
            color: item.color,
            quantity: item.qty,
        }));
        const { error: itemsErr } = await sb.from('order_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        const customer = customers.find(c => String(c.id) === String(customerId));
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
            cart = [];
            renderCart();
            browseMode = 'categories';
            searchInput.value = '';
            renderBrowseArea();
            customerSelect.value = '';
            customerInfo.textContent = '';
        });
    } catch (e) {
        alert('儲存失敗：' + e.message);
    } finally {
        saveOrderBtn.disabled = false;
        saveOrderBtn.textContent = '儲存訂單並出單';
    }
});

initAdminAuth('pos', initPos);
